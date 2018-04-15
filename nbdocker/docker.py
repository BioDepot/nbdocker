import os
import platform
import re
import json
import threading
import requests
import tempfile
import uuid
import shutil
import time
import docker as dockerpy
from queue import Queue, Empty
from notebook.utils import url_path_join
from notebook.base.handlers import IPythonHandler
from tornado import web, gen
from tornado.iostream import StreamClosedError


# global docker instance
g_docker_ = None
try:
    if platform.system() is 'Windows':
        g_docker_ = dockerpy.APIClient(base_url='npipe:////./pipe/docker_engine')
    else:
        g_docker_ = dockerpy.APIClient(base_url='unix:///var/run/docker.sock')
except:
    g_docker_ = None


# global variables
# notebook name and its docker commands history
nbname_cmd_dict = {}
# notebook working directory
notebook_dir = ''


class Build:
    def __init__(self, manager, uid, docker_cli, image_name, docker_file):
        self.manager = manager
        self.uid = uid
        self.q = Queue()
        self.docker_ = docker_cli
        self.image_name = image_name
        self.docker_file = docker_file

    def building(self):
        # prepare building folder
        # each building has its own temporary folder
        build_path = tempfile.mkdtemp(suffix='nbdocker')
        shadow_dockerfile = os.path.join(build_path, 'Dockerfile')
        with open(shadow_dockerfile, 'wb') as fp:
            fp.write(self.docker_file.encode('utf-8'))

        print('Start building image {0} ---->>> \n docker file: {1} \n use path: {2}'.format(self.image_name, shadow_dockerfile, build_path))
        try:
            for rawline in self.docker_.build(path=build_path, tag=self.image_name, rm=True):
                for jsonstr in rawline.decode('utf-8').split('\r\n')[:-1]:
                    log = jsonstr
                    try:
                        line = json.loads(jsonstr)
                        log = line['stream']
                    except ValueError as e:
                        print(e)
                    except TypeError as e:
                        print(e)
                    except KeyError as e:
                        log = ', '.join("{!s}={!r}".format(key, val) for (key, val) in line.items())
                    except:
                        log = ''
                    self.progress('build.message', log)

            self.progress('build.status', 'Succeeded')

        except requests.exceptions.RequestException as e:
            self.progress('build.message', e.explanation + '\n')
            self.progress('build.status', 'Failed')
        except Exception as e:
            self.progress('build.message', e.explanation + '\n')
            self.progress('build.status', 'Failed')

        shutil.rmtree(build_path)
        self.manager.remove_build(self.uid)

    def progress(self, kind, obj):
        self.q.put_nowait({'kind': kind, 'payload': obj})


class RunShcheduler:
    def __init__(self, docker_cli, nb_name):
        self._docker = docker_cli
        self._nb_name = nb_name
        self.q = Queue()
        self._task_status = {}
        self._thread = None

    def runner(self):
        while True:
            try:
                record_id = self.q.get_nowait()
            except Empty:
                yield gen.sleep(2)
                continue
            
            container_option = None
            for r in nbname_cmd_dict[self._nb_name]:
                if str(r["Id"]) == record_id:
                    container_option = r
                    break
            
            self._task_status[record_id] = 'running'

            container_id = None
            if container_option:
                container_id = self._docker._create_container(container_option)

                while self._docker.is_container_running(container_id):
                    time.sleep(2)
                self._docker.remove_container(container_id)

            self.q.task_done()
            self._task_status[record_id] = 'completed'


    def start(self):
        self._thread = threading.Thread(target=self.runner)
        self._thread.start()

    def add_task(self, record_id):
        self.q.put_nowait(record_id)
        self._task_status[record_id] = 'waiting'
        
class RunSchedulerManager(object):
    def __init__(self):
        pass

    def get_runner(self, nb_name):
        pass

    def new_scheduler(self, nb_name):
        pass


class BuildManager(object):
    def __init__(self):
        self.builds = {}
        self.threads = {}

    def new_build(self, image_name, docker_file):
        uid = uuid.uuid4().hex
        b = Build(self, uid, g_docker_, image_name, docker_file)
        self.builds[uid] = b
        build_thread = threading.Thread(target=b.building)
        build_thread.start()
        self.threads[uid] = build_thread
        print('New build-{} submited, total builds: {}'.format(uid, len(self.builds)))
        return uid

    def get_build(self, uid):
        if uid not in self.builds:
            return None
        return self.builds[uid]

    def remove_build(self, uid):
        if uid in self.builds:
            del self.builds[uid]
        if uid in self.threads:
            del self.threads[uid]
        print('Removed build-{}'.format(uid))


g_docker_builder = BuildManager()


class DockerHandler(IPythonHandler):
    def initialize(self):
        if platform.system() is 'Windows':
            self._docker = dockerpy.APIClient(base_url='npipe:////./pipe/docker_engine')
        else:
            self._docker = dockerpy.APIClient(base_url='unix:///var/run/docker.sock')

    def _locate_user_data(self):
        user_volume = None

        if 'HOSTNAME' in os.environ:
            container_id = os.environ['HOSTNAME']
            for c in self._docker.containers(all=False):
                c_id = c['Id']
                if len(c_id) < 12:
                    continue

                if c_id[:12] == container_id:
                    for m in c['Mounts']:
                        if m['Type'] == 'volume' and 'jupyterhub-user-' in m['Name']:
                            user_volume = m['Name']
                            break
                        elif m['Type'] == 'bind' and '/home/jovyan/work' in m['Destination']:
                            user_volume = m['Source']

        return user_volume

    def post(self):
        dispatch_table = {
            'info': self._event_get_docker_info,
            'listimage': self._event_list_images,
            'listcontainer': self._event_list_containers,
            'createcontainer': self._event_create_container,
            'removecontainer': self._event_remove_container,
            'buildsubmit': self._event_build_submit,
            'savehistory': self._event_save_history,
            'listhistory': self._event_list_history,
            'removehistory': self._event_remove_history,
            'rereunhistory': self._event_rerun_history,
            'gethistory': self._event_get_history,
            'containerstatus': self._event_container_status,
        }
        cmd = self.get_body_argument('cmd')

        fn = None
        try:
            fn = dispatch_table[cmd]
        except KeyError:
            self.send_error(500)

        if fn is not None:
            return self.finish(fn())

    def _event_get_docker_info(self):
        return self._docker.info()

    def _event_list_images(self):
        return {'images': self._docker.images()}

    def _event_list_containers(self):
        return {'containers': self._docker.containers()}

    def _event_create_container(self):
        options = self.get_body_argument('options')
        options = json.loads(options)
        
        _containerId = self._create_container(options)

        if _containerId != 'ImageNotFound':
            # save the notebook name and its commands to the dict
            nb_name = options['notebookname']
            nb_name, _ = os.path.splitext(nb_name)
            options['notebookname'] = nb_name
            if nb_name in nbname_cmd_dict:
                options['Id'] = len(nbname_cmd_dict[nb_name])
                nbname_cmd_dict[nb_name].append(options)
            else:
                options['Id'] = 0;
                nbname_cmd_dict[nb_name] = [options]

        return {'container_id': _containerId}

    def _create_container(self, options):
        # Check if the image exists locally!
        try:
            docker_client = dockerpy.from_env(version='auto')
            docker_client.images.get(options['image'])
        except dockerpy.errors.ImageNotFound:
            # image doesn't exist, pullit
            return 'ImageNotFound'


        # passing docker.sock into container so that the container could access docker engine
        volumes = {'/var/run/docker.sock': '/var/run/docker.sock'}
        if options['host'] and options['container']:
            volumes[options['host']] = options['container']

        jupyter_user_volume = self._locate_user_data()
        if jupyter_user_volume:
            volumes[jupyter_user_volume] = '/.nbdocker'

        ports = {}
        if options['internal'] and options['external']:
            ports[int(options['internal'])] = int(options['external'])

        binds = []
        for s, d in volumes.items():
            binds.append(s + ":" + d)
        volumes = list(volumes.values())

        port_bindings = {}
        for i, e in ports.items():
            port_bindings[i] = e

        ports = list(ports.keys())

        host_config = self._docker.create_host_config(binds=binds, port_bindings=port_bindings)

        commands = ''
        if options['command']:
            commands = 'bash -c "' + options['command'] + '"'

        _containerId = self._docker.create_container(image=options['image'],
                                                     volumes=volumes,
                                                     ports=ports,
                                                     command=commands,
                                                     host_config=host_config)

        self._docker.start(_containerId)
        return _containerId

    def is_container_running(self, container_id):
        for container in self._docker.containers(all=False):
            if container['Id'] == container_id:
                return True
        return False

    def remove_container(self, container_id, force=False):
        self._docker.remove_container(container_id, force=force)

    def _event_remove_container(self):
        container_id = self.get_body_argument('container_id')

        self._docker.stop(container_id)
        try:
            self.remove_container(container_id, force=True)
        except:
            pass

    def _event_build_submit(self):
        image_name = self.get_body_argument('image_name')
        docker_file = self.get_body_argument('docker_file')

        if not image_name:
            return {'message': 'Please specify a image name!'}

        pattern = re.compile("^(?:(?=[^:\/]{1,253})(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(?:\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))*(?::[0-9]{1,5})?/)?((?![._-])(?:[a-z0-9._-]*)(?<![._-])(?:/(?![._-])[a-z0-9._-]*(?<![._-]))*)(?::(?![.-])[a-zA-Z0-9_.-]{1,128})?$")
        if not pattern.search(image_name):
            return {'message': 'Invalid image name, typical image name:\n  registry/image-name[:version] \n\n  For example: \n  biodepot/bwb:latest'}
        
        # skip empty docker file
        if not docker_file.strip():
            return {'message': 'Error: empty Docker file'}
        
        # create a new build instance and return uuid to client
        return {'uuid': g_docker_builder.new_build(image_name, docker_file)}

    # Save the commands for a notebook by looking up the nbname_cmd_dict
    def _event_save_history(self):
        nb_path = self.get_body_argument('notebook_name')
        nb_name, _ = os.path.splitext(nb_path)

        self.log.info("nbdocker saving {} history".format(nb_name))

        if not nb_name or nb_name not in nbname_cmd_dict:
            return {'message': 'No history!'}
        else:
            cmds = nbname_cmd_dict[nb_name]
            print("saving cmd history to: " + nb_path)
            with open(nb_path) as data_file:
                data = json.load(data_file)
            data["metadata"]["cmd_history"] = cmds 
            with open(nb_path, 'w') as f:
                json.dump(data, f)

            return {'message': 'History saved!'}
    
    def _loading_history(self, nb_path, nb_name):
        if nb_name not in nbname_cmd_dict:
            self.log.info("Loading history from notebook's metadata")
            cmds = []
            with open(nb_path) as f:
                data = json.load(f)
            if "cmd_history" in data["metadata"]:
                nbname_cmd_dict[nb_name] = data["metadata"]["cmd_history"]
            else:
                nbname_cmd_dict[nb_name] = []

    # Load cmd histories by notebook name
    def _event_list_history(self):
        nb_path = self.get_body_argument('notebook_name')
        nb_name, _ = os.path.splitext(nb_path)

        self.log.info("Loading history for notebook: " + nb_name)
        if not nb_name:
            return {'history': []}

        self._loading_history(nb_path, nb_name)
                
        return {'history': nbname_cmd_dict[nb_name]}

    def _event_remove_history(self):
        nb_name = self.get_body_argument('notebook_name')
        nb_name, _ = os.path.splitext(nb_name)
        record_id = self.get_body_argument('record_id')
        if nb_name in nbname_cmd_dict:
            hist_dict = []
            rec_index = 0
            for record in nbname_cmd_dict[nb_name]:
                if str(record['Id']) != record_id:
                    record['Id'] = rec_index
                    rec_index += 1
                    hist_dict.append(record)

            nbname_cmd_dict[nb_name] = hist_dict
        self.log.info(nbname_cmd_dict[nb_name])

    def _event_rerun_history(self):
        nb_name = self.get_body_argument('notebook_name')
        nb_name, _ = os.path.splitext(nb_name)
        record_id = self.get_body_argument('record_id')

        record = None
        for r in nbname_cmd_dict[nb_name]:
            self.log.info(r["Id"])
            if str(r["Id"]) == record_id:
                record = r
                break

        _containerId = ""
        if record:
            _containerId = self._create_container(record)

        return {'container_id': _containerId }

    def _event_get_history(self):
        nb_path = self.get_body_argument('notebook_name')
        nb_name, _ = os.path.splitext(nb_path)
        record_id = self.get_body_argument('record_id')

        self._loading_history(nb_path, nb_name)

        record = None
        for r in nbname_cmd_dict[nb_name]:
            if str(r["Id"]) == record_id:
                record = r
                break
        
        return {'history': record}

    def _event_container_status(self):
        data = self.get_body_argument('containers')
        containers = json.loads(data)

        parttern = re.compile('Exited[a-zA-z\s\(]+(\d+)')
        for key in containers:
            c_front = containers[key]
            c = self._locate_container(c_front['id'], all=True)
            if c:
                match = parttern.search(c['Status'])
                if match:
                    if match.group(1) == "0":
                        c_front['status'] = 'Finished.'
                    else:
                        c_front['status'] = 'Error, code=' + match.group()                   
                else:
                    c_front['status'] = c['Status']

        return {'containers': containers}

    def _locate_container(self, container_id, all=False):
        for c in self._docker.containers(all=all):
            c_id = c['Id']
            if len(c_id) < 12:
                continue
            
            c_id = c_id[:12]
            if c_id == container_id:
                return c
        return None



class PullHandler(web.RequestHandler):
    @gen.coroutine
    def emit(self, data):
        if type(data) is not str:
            serialized_data = json.dumps(data)
        else:
            serialized_data = data
        self.write('data: {}\n\n'.format(serialized_data))
        yield self.flush()

    @gen.coroutine
    def get(self, registry, image_name, image_version):
        # We gonna send out event streams!
        self.set_header('content-type', 'text/event-stream')
        self.set_header('cache-control', 'no-cache')

        # print(registry, image_name, image_version)
        
        if image_version is None:
            image_version = image_name
            image_name = registry
        else:
            image_name = registry + '/' + image_name

        # Check if the image exists locally!
        docker_client = dockerpy.from_env(version='auto')
        try:
            docker_client.images.get(image_name)
            self.emit({'message': 'Image exists locally, pull completed.\n'})
            return
        except dockerpy.errors.ImageNotFound:
            # image doesn't exist, so do a build!
            pass

        q = Queue()
        pull = Pull(q, g_docker_, image_name, image_version)
        pull_thread = threading.Thread(target=pull.pull)
        pull_thread.start()

        done = False
        while True:
            try:
                progress = q.get_nowait()
            except Empty:
                yield gen.sleep(0.5)
                continue

            # event process
            # We expect logs already JSON format
            if progress['kind'] == 'pull.status':
                if progress['payload'] == 'Failed' or progress['payload'] == 'Succeeded':
                    done = True
                    event = {'message': progress['payload']}
            elif progress['kind'] == 'pull.progress':
                event = {'progress': progress['payload']}

            try:
                yield self.emit(event)
                q.task_done()
                if done:
                    break
            except StreamClosedError:
                # Client has gone away!
                break


class Pull:
    def __init__(self, q, docker_cli, image_name, image_version):
        self.q = q
        self.docker_ = docker_cli
        self.image_name = image_name
        self.image_version = image_version

    def progress(self, kind, obj):
        self.q.put_nowait({'kind': kind, 'payload': obj})

    def pull(self):
        repo_tag = self.image_name + ':' + self.image_version
        print('Pulling image {}'.format(repo_tag))
        try:
            # Docker splits downloads into multiple parts
            # We create a dict mapping id to % finished for each part (progress)
            # The total progress is the mean of individual progresses
            progs = dict()
            for line in self.docker_.pull(repo_tag, stream=True):
                for status in line.decode('utf-8').split('\r\n')[:-1]:
                    line = json.loads(status)
                    statusStr = line['status']
                    if statusStr == 'Pulling fs layer':
                        progs[line['id']] = 0
                    # First 50% progress is Downloading
                    elif statusStr == 'Downloading':
                        progDetail = line['progressDetail']
                        if len(progDetail) > 1:
                            progs[line['id']] = progDetail['current'] / progDetail['total'] * 50
                    # Last 50% progress is Extracting
                    elif statusStr == 'Extracting':
                        progDetail = line['progressDetail']
                        if len(progDetail) > 1:
                            progs[line['id']] = 50 + (progDetail['current'] / progDetail['total'] * 50)
                    if (len(progs) > 0):
                        self.current_progress = sum(progs.values()) / len(progs)
                        self.progress('pull.progress', self.current_progress)

            self.progress('pull.status', 'Succeeded')
        except requests.exceptions.RequestException as e:
            print(e)
            self.progress('pull.status', 'Failed')
        except Exception as e:
            print(e)
            self.progress('pull.status', 'Failed')


class BuildHandler(web.RequestHandler):
    @gen.coroutine
    def emit(self, data):
        if type(data) is not str:
            serialized_data = json.dumps(data)
        else:
            serialized_data = data
        self.write('data: {}\n\n'.format(serialized_data))
        yield self.flush()

    @gen.coroutine
    def get(self, uid):
        # We gonna send out event streams!
        self.set_header('content-type', 'text/event-stream')
        self.set_header('cache-control', 'no-cache')

        done = False

        # locate the build instance
        b = g_docker_builder.get_build(uid)
        if b is not None:
            while True:
                try:
                    msg = b.q.get_nowait()
                except Empty:
                    yield gen.sleep(0.5)
                    continue

                if msg['kind'] == 'build.status':
                    if msg['payload'] == 'Failed' or msg['payload'] == 'Succeeded':
                        done = True
                        event = {'status': msg['payload']}
                elif msg['kind'] == 'build.message':
                    event = {'message': msg['payload']}

                try:
                    yield self.emit(event)
                    b.q.task_done()
                    if done:
                        break
                except StreamClosedError:
                    # Client has gone away!
                    break


def load_jupyter_server_extension(nb_app):
    # debug info
    nb_app.log.info("server info")
    server_info = nb_app.server_info()
    nb_app.log.info(server_info)

    # get notebook working dir
    notebook_dir = server_info['notebook_dir']
    nb_app.log.info("Get the current directory: " + notebook_dir)

    web_app = nb_app.web_app
    host_pattern = '.*$'
    # register handlers
    route_docker = url_path_join(web_app.settings['base_url'], '/docker')
    route_docker_pull = url_path_join(web_app.settings['base_url'], r"/dockerpull/([^/]+)/([^/]+)?/?([^/]+)?")
    route_docker_build = url_path_join(web_app.settings['base_url'], r"/dockerbuild/([^/]+)")
    web_app.add_handlers(host_pattern, [
        (route_docker, DockerHandler),
        (route_docker_pull, PullHandler),
        (route_docker_build, BuildHandler)
    ])
    nb_app.log.info("nbdocker server extension loaded!")

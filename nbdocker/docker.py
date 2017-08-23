import docker
import json
import re
import os
import tempfile
import shutil
from queue import Queue, Empty
import uuid
import threading
import requests
from notebook.utils import url_path_join
from notebook.base.handlers import IPythonHandler
from tornado import web, gen
from tornado.iostream import StreamClosedError


# global docker instance
g_docker_ = None
try:
    g_docker_ = docker.APIClient(base_url='unix:///var/run/docker.sock')
except:
    g_docker_ = None


class Build:
    def __init__(self, manager, uid, docker_cli, image_name, docker_file):
        self.manager = manager
        self.uid = uid
        self.q = Queue()
        self.docker_ = docker_cli
        self.image_name = image_name
        self.docker_file = docker_file

    def building(self):
        build_path = tempfile.mkdtemp(suffix='nbdocker')
        shadow_dockerfile = os.path.join(build_path, 'Dockerfile')
        with open(shadow_dockerfile, 'wb') as fp:
            fp.write(self.docker_file.encode('utf-8'))

        print('Start building image {0} ---->>> \n docker file: {1} \n use path: {2}'.format(self.image_name, shadow_dockerfile, build_path))

        try:
            for rawline in self.docker_.build(path=build_path, tag=self.image_name, dockerfile=shadow_dockerfile, rm=True):
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
        self._docker = docker.APIClient(base_url='unix:///var/run/docker.sock')

    def post(self):
        dispatch_table = {
            'info': self._event_get_docker_info,
            'listimage': self._event_list_images,
            'listcontainer': self._event_list_containers,
            'createcontainer': self._event_create_container,
            'removecontainer': self._event_remove_container,
            'buildsubmit': self._event_build_submit
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
        volumes = {'/var/run/docker.sock': '/var/run/docker.sock',
                   options['host']: options['container']}
        ports = {int(options['internal']): int(options['external'])}

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
        return {'container_id': _containerId}

    def _event_remove_container(self):
        container_id = self.get_body_argument('container_id')

        self._docker.stop(container_id)
        try:
            self._docker.remove_container(container_id, force=True)
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

        return {'uuid': g_docker_builder.new_build(image_name, docker_file)}


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

        print(registry, image_name, image_version)
        
        if image_version is None:
            image_version = image_name
            image_name = registry
        else:
            image_name = registry + '/' + image_name

        # Check if the image exists locally!
        # Assume we're running in single-node mode!
        docker_client = docker.from_env(version='auto')
        try:
            image = docker_client.images.get(image_name)
            self.emit({'message': 'Image exists locally, pull completed.\n'})
            return
        except docker.errors.ImageNotFound:
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

            # FIXME: If pod goes into an unrecoverable stage, such as ImagePullBackoff or
            # whatever, we should fail properly.
            if progress['kind'] == 'pull.status':
                if progress['payload'] == 'Failed' or progress['payload'] == 'Succeeded':
                    done = True
                    event = {'message': progress['payload']}
            elif progress['kind'] == 'pull.progress':
                # We expect logs to be already JSON structured anyway
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
            # for i in range(10):
            #     self.progress('pull.progress', i+1)
            #     sleep(1)

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
                    # We expect logs to be already JSON structured anyway
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
    web_app = nb_app.web_app
    host_pattern = '.*$'
    route_docker = url_path_join(web_app.settings['base_url'], '/docker')
    route_docker_pull = url_path_join(web_app.settings['base_url'], r"/dockerpull/([^/]+)/([^/]+)?/?([^/]+)?")
    route_docker_build = url_path_join(web_app.settings['base_url'], r"/dockerbuild/([^/]+)")
    web_app.add_handlers(host_pattern, [
        (route_docker, DockerHandler),
        (route_docker_pull, PullHandler),
        (route_docker_build, BuildHandler)
    ])
    nb_app.log.info("nbdocker server extension loaded!")

import docker
import json
from queue import Queue, Empty
from time import sleep
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


class DockerHandler(IPythonHandler):
    def initialize(self):
        self._docker = docker.APIClient(base_url='unix:///var/run/docker.sock')

    def post(self):
        dispatch_table = {
            'info': self._event_get_docker_info,
            'listimage': self._event_list_images,
            'listcontainer': self._event_list_containers,
            'createcontainer': self._event_create_container,
            'removecontainer': self._event_remove_container
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


def load_jupyter_server_extension(nb_app):
    web_app = nb_app.web_app
    host_pattern = '.*$'
    route_docker = url_path_join(web_app.settings['base_url'], '/docker')
    route_docker_pull = url_path_join(web_app.settings['base_url'], r"/dockerpull/([^/]+)/([^/]+)?/?([^/]+)?")
    web_app.add_handlers(host_pattern, [
        (route_docker, DockerHandler),
        (route_docker_pull, PullHandler)
    ])
    nb_app.log.info("nbdocker server extension loaded!")

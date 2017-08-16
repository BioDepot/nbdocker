import docker
import json
from notebook.utils import url_path_join
from notebook.base.handlers import IPythonHandler


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


def load_jupyter_server_extension(nb_app):
    web_app = nb_app.web_app
    host_pattern = '.*$'
    route_pattern = url_path_join(web_app.settings['base_url'], '/docker')
    web_app.add_handlers(host_pattern, [(route_pattern, DockerHandler)])
    nb_app.log.info("nbdocker server extension loaded!")

import ipywidgets as widgets
import docker
from traitlets import Dict, List, observe, Unicode

@widgets.register
class DockerManager(widgets.DOMWidget):

    """"""
    _view_name = Unicode('DockerView').tag(sync=True)
    _model_name = Unicode('DockerModel').tag(sync=True)
    _view_module = Unicode('ipydocker').tag(sync=True)
    _model_module = Unicode('ipydocker').tag(sync=True)
    _view_module_version = Unicode('^0.1.0').tag(sync=True)
    _model_module_version = Unicode('^0.1.0').tag(sync=True)

    _cli = docker.APIClient(base_url='unix:///var/run/docker.sock')
    # docker_version = Unicode(_cli.version()['Version']).tag(sync=True)
    docker_info = Dict().tag(sync=True)
    command = Unicode('').tag(sync=True)
    containers = List().tag(sync=True)
    images = List().tag(sync=True)
    parameters = Dict().tag(sync=True)

    @observe("command")
    def _on_command_change(self, changed):
        self.command = changed['new']
        if self.command == 'ps':
            self.containers = []
            self.containers = self._cli.containers()
        elif self.command == 'images':
            self.images = []
            self.images = self._cli.images()
        elif self.command == 'create':
            self._create_container()
        elif self.command == 'remove':
            self._remove_container()
        elif self.command == 'info':
            self.docker_info = self._cli.info()

    def _create_container(self):
        volumes = {'/var/run/docker.sock': '/var/run/docker.sock',
                   self.parameters['host']: self.parameters['container']}
        ports = {int(self.parameters['internal']): int(self.parameters['external'])}

        binds = []
        for s, d in volumes.items():
            binds.append(s + ":" + d)
        volumes = list(volumes.values())

        port_bindings = {}
        for i, e in ports.items():
            port_bindings[i] = e
        ports = list(ports.keys())

        host_config = self._cli.create_host_config(binds=binds, port_bindings=port_bindings)

        commands = ''
        if self.parameters['command']:  
            commands = 'bash -c "' + self.parameters['command'] + '"'

        _containerId = self._cli.create_container(image=self.parameters['image'],
                                                  volumes=volumes,
                                                  ports=ports,
                                                  command=commands,
                                                  host_config=host_config)

        self._cli.start(_containerId)
        self.containers = []
        self.containers = self._cli.containers()

    def _remove_container(self):
        if self.parameters['containerId']:
            self._cli.stop(self.parameters['containerId'])
            try:
                self._cli.remove_container(self.parameters['containerId'], force=True)
            except:
                pass
                
            self.containers = []
            self.containers = self._cli.containers()

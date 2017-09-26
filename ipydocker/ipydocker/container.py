import ipywidgets as widgets
import threading
import docker
from time import sleep
from traitlets import Unicode, observe

@widgets.register
class DockerContainer(widgets.DOMWidget):

    """"""
    _view_name = Unicode('ContainerView').tag(sync=True)
    _model_name = Unicode('ContainerModel').tag(sync=True)
    _view_module = Unicode('ipydocker').tag(sync=True)
    _model_module = Unicode('ipydocker').tag(sync=True)
    _view_module_version = Unicode('^0.1.0').tag(sync=True)
    _model_module_version = Unicode('^0.1.0').tag(sync=True)

    _cli = docker.APIClient(base_url='unix:///var/run/docker.sock')

    container_id = Unicode('').tag(sync=True)
    image = Unicode('').tag(sync=True)
    status = Unicode('').tag(sync=True)
    ctl_command = Unicode('').tag(sync=True)

    def __init__(self, image, volumes={}, commands=[], ports={}, **kwargs):
        super().__init__(**kwargs)

        self._commands = commands
        self._volumes = volumes
        self._ports = ports
        self.image = image
        
        self._run()

    @observe("ctl_command")
    def _on_command_changed(self, changed):
        self.ctl_command = changed['new']
        if self.ctl_command == 'remove':
            self._remove_container()

    def _remove_container(self):
        self._cli.stop(self.container_id)
        self._cli.remove_container(self.container_id, force=True)
        self.status = 'Stopped'

    def _run_container(self):
        binds = []
        if isinstance(self._volumes, dict):
            for host_dir, container_dir in self._volumes.items():
                binds.append(host_dir + ":" + container_dir)
            volumes = list(self._volumes.values())
            
        port_bindings = {}
        for i, e in self._ports.items():
            port_bindings[i] = e
        ports = list(self._ports.keys())

        host_config = self._cli.create_host_config(binds=binds, port_bindings=port_bindings)

        commands = self._commands
        if isinstance(self._commands, list) and len(self._commands) > 0:
            commands = "bash -c \"" + ' && '.join(self._commands) + "\""

        response = self._cli.create_container(image=self.image,
                                              volumes=volumes,
                                              command=commands,
                                              ports=ports,
                                              host_config=host_config)
        if response['Warnings'] is None:
            self.container_id = response['Id']
            self._cli.start(self.container_id)
            self.status = 'Running'
        else:
            print(response['Warnings'])

        # Keep running until container is exited
        while self._container_running():
            sleep(1)
        # Remove the container when it is finished
        try:
            self._cli.remove_container(self.container_id)
        except:
            pass
        self.status = 'Stopped'

    def _container_running(self):
        for container in self._cli.containers(all=False):
            if container['Id'] == self.container_id:
                return True
        return False

    def _run(self):
        t = threading.Thread(target=self._run_container)
        t.start()

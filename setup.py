import os
from setuptools import setup
from setuptools.command.install import install

from notebook.nbextensions import install_nbextension
from notebook.services.config import ConfigManager
from jupyter_core.paths import jupyter_config_dir

EXT_DIR = os.path.join(os.path.dirname(__file__), 'nbdocker')


class InstallCommand(install):
    def run(self):
        # Install Python package
        install.run(self)

        # Install JavaScript extensions to ~/.local/jupyter/
        install_nbextension(EXT_DIR, overwrite=True, user=True)

        # Activate the JS extensions on the notebook, tree, and edit screens
        js_cm = ConfigManager()
        js_cm.update('notebook', {"load_extensions": {'nbdocker/notebook': True}})
        js_cm.update('tree', {"load_extensions": {'nbdocker/dashboard': True}})
        js_cm.update('edit', {"load_extensions": {'nbdocker/editor': True}})

        # Activate the Python server extension
        server_cm = ConfigManager(config_dir=jupyter_config_dir())
        cfg = server_cm.get('jupyter_notebook_config')
        server_extensions = (cfg.setdefault('NotebookApp', {}).setdefault('server_extensions', []))
        if extension not in server_extensions:
            cfg['NotebookApp']['server_extensions'] += ['nbdocker.DockerHanlder']
            server_cm.update('jupyter_notebook_config', cfg)


setup(
    name='nbdocker',
    version='0.2',
    packages=['nbdocker'],
    cmdclass={
        'install': InstallCommand
    },
    description="Jupyter Notebook extension for Docker",
    author="Jiaming Hu",
    author_email='huj22@uw.edu',
    maintainer="Jiaming Hu",
    maintainer_email='huj22@uw.edu',
    url='https://github.com/BioDepot/nbdocker',
    license='BSD',
    keywords=['docker', 'nbextension', 'jupyter', 'notebook']
)
"""Docker extension for Jupyter Notebook
"""
from .docker import load_jupyter_server_extension


__version__ = '0.1'


def _jupyter_server_extension_paths():
    return [
        dict(module='nbdocker.docker'),
    ]
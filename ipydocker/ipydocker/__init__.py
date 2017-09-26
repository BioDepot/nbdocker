from ._version import version_info, __version__

from .docker import *

def _jupyter_nbextension_paths():
    return [{
        'section': 'notebook',
        'src': 'static',
        'dest': 'ipydocker',
        'require': 'ipydocker/extension'
    }]

#! /usr/bin/env bash
echo -n "Checking npm... "
npm -v
if [ $? -ne 0 ]; then
    echo "'npm -v' failed, therefore npm is not installed.  In order to perform a
    developer install of ipywidgets you must have both npm and pip installed on your
    machine! See http://blog.npmjs.org/post/85484771375/how-to-install-npm for
    installation instructions."
    exit 1
fi

echo -n "Checking pip3... "
pip3 --version
if [ $? -ne 0 ]; then
    echo "'pip3 --version' failed, therefore pip is not installed. In order to perform
    a developer install of ipywidgets you must have both pip and npm installed on
    your machine! See https://packaging.python.org/installing/ for installation instructions."
    exit 1
fi

jupyter nbextension uninstall --py --sys-prefix ipydocker
rm -rf ipydocker/static/

# All following commands must run successfully
python3 setup.py build
pip3 install -e .

jupyter nbextension install --py --symlink --sys-prefix ipydocker
jupyter nbextension enable --py --sys-prefix ipydocker

[![Docker Pulls](https://img.shields.io/docker/pulls/mashape/kong.svg)](https://hub.docker.com/r/biodepot/nbdocker/)

NBDocker
====================


The nbdocker is an extension that allows for different Docker containers to be executed inside Jupyter notebooks. Each Docker container encapsulates its individual computing environment, thus allows different programming languages and computing environments to be included in one single notebook, provides the user to document the code as well as the computing environment.

## GENERAL INFORMATION
Docker image: https://hub.docker.com/r/biodepot/nbdocker/

## Installation
A pre-installed Docker image was provided which contains Jupyter notebook and nbdocker as well.

```shell
docker pull biodepot/nbdocker
```

## Development Install
The installation instructions below are intended for developers who want to manually install the nbdocker for the purposes of development.

### Basic environment
In order to run nbdocker on your local machine, you will need:

[Python 3](https://www.python.org/downloads/) >= 3.5.0

[docker-py](https://github.com/docker/docker-py) >= 3.0.0

If you don't have [Jupyter Notebook](http://jupyter.org/) installed, you can install it by running:
```bash
python3 -m pip install jupyter
```

### Install NBDocker
#### Clone repo
> git clone https://github.com/jmhoo/nbdocker.git

#### Install nbdocker package
```bash
cd nbdocker
pip3 install -e --user .
```

#### Jupyter extension
Finnally, install server extension and notebook extension for Jupyter:

```bash
jupyter serverextension enable --py --user nbdocker
jupyter nbextension install nbdocker/nbdocker --user
jupyter nbextension enable nbdocker/main --user
```

## Demo
![](nbdocker/nbdocker.gif)

Bioinformatics Group University of Washington Tacoma

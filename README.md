# nb extension for Docker

A Jupyter Notebook extension for Docker

# Pre-installed docker image
`docker pull biodepot/nbdocker`

# Manually installation

`git clone https://github.com/jmhoo/nbdocker.git`

`pip install -e nbdocker --user`

`jupyter serverextension enable --py --user nbdocker`

`jupyter nbextension install nbdocker/nbdocker --user`

`jupyter nbextension enable nbdocker/main --user`

# Demo
![](nbdocker/nbdocker.gif)

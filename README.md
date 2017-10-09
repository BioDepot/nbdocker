Jupyter Hub with ipydocker and nbdocker
Docker image is built and pushed to dockerhub manually, to run it, execute:
```
docker run -it -p 8888:8888 -v /var/run/docker.sock:/var/run/docker.sock biodepot/nbdocker
```
Then you can access the jyputer hub by browsing http://localhost:8888

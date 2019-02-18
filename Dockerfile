FROM biodepot/nbdocker-base-ir:latest
MAINTAINER lhhung@uw.edu
ENV NB_USER jovyan
RUN useradd -rm -d /home/$NB_USER -s /bin/bash -g root -G sudo -u 1000 $NB_USER

#Set permissions for nbdocker to user
USER root
ADD nbdocker /home/$NB_USER/nbdocker
ADD setup.py /home/$NB_USER/.
RUN chown -R $NB_USER /home/$NB_USER/nbdocker

#install nbdocker
RUN cd /home/$NB_USER/ && pip install -e . --user && \
    jupyter serverextension enable --py --user nbdocker && \
    jupyter nbextension install nbdocker --user && \
    jupyter nbextension enable nbdocker/main --user

#install R kernel    
RUN R -e "IRkernel::installspec()"

#setup starting enviroinment
WORKDIR /home/$NB_USER/work
CMD ["jupyter","notebook","--ip","0.0.0.0"]

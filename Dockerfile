FROM biodepot/nbdocker-base-ir:user
MAINTAINER lhhung@uw.edu

#Set permissions for nbdocker to user

ADD nbdocker /home/$NB_USER/nbdocker
ADD setup.py /home/$NB_USER/.
RUN chown -R $NB_USER /home/$NB_USER/nbdocker

USER $NB_USER
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

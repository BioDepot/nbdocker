FROM biodepot/bioconductor:3.6__ubuntu-18.04__R-3.4.3__081318
MAINTAINER lhhung@uw.edu
ENV NB_USER jovyan
#install jupyter and docker python api 
RUN apt-get update && apt-get -y install \ 
    build-essential python3-all python3-pip libncurses5-dev libncursesw5-dev libzmq3-dev libcurl4-openssl-dev libssl-dev zlib1g-dev\
    && pip3 install --upgrade pip \
    && pip install jupyter ipywidgets jupyter_nbextensions_configurator jupyter_contrib_nbextensions requests docker \
    && apt-get -y remove build-essential \
    && apt-get autoclean -y \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
    
#install Docker-ce
RUN apt-get update && apt-get install -y  \
    apt-transport-https ca-certificates software-properties-common curl gnupg2 wget git\
    && curl -fsSL https://download.docker.com/linux/ubuntu/gpg | apt-key add -\
    &&  add-apt-repository -y \
    "deb [arch=amd64] https://download.docker.com/linux/ubuntu bionic stable" \
    && apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io\
    && apt-get remove -y apt-transport-https software-properties-common gnupg2 curl wget \
    && apt-get autoclean -y \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* 
    
#install IR kernel
ADD installIR.R /tmp
RUN Rscript /tmp/installIR.R 
#RUN R -e "install.packages(c('IRdisplay', 'repr', 'devtools', 'evaluate', 'crayon','pbdZMQ', 'uuid', 'digest' ),repos = 'http://cran.us.r-project.org'); \
#          devtools::install_github('IRkernel/IRkernel',host='https://api.github.com'); "

RUN useradd -rm -d /home/$NB_USER -s /bin/bash -g root -G sudo -u 1000 $NB_USER

#Set permissions for nbdocker to user
USER root
ADD nbdocker /home/$NB_USER/nbdocker
ADD setup.py /home/$NB_USER/.
RUN chown -R $NB_USER /home/$NB_USER/nbdocker

#install IR kernel
RUN R -e "install.packages(c('IRdisplay', 'repr', 'devtools', 'evaluate', 'crayon','pbdZMQ', 'uuid', 'digest' ),repos = 'http://cran.us.r-project.org'); \
          devtools::install_github('IRkernel/IRkernel',host='https://api.github.com'); "
          
#Set permissions for nbdocker to user
USER root
ADD nbdocker /home/$NB_USER/nbdocker
ADD setup.py /home/$NB_USER/.
RUN chown -R $NB_USER /home/$NB_USER/nbdocker

USER $NB_USER

RUN cd /home/$NB_USER/ && pip install -e . --user && \
    jupyter serverextension enable --py --user nbdocker && \
    jupyter nbextension install nbdocker --user && \
    jupyter nbextension enable nbdocker/main --user

#install R kernel    
RUN R -e "IRkernel::installspec()"

#setup starting enviroinment
WORKDIR /home/$NB_USER/work
CMD ["jupyter","notebook","--ip","0.0.0.0"]



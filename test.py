#!/usr/bin/python3
import os
import platform
import re
import json
import threading
import requests
import tempfile
import uuid
import shutil
import time
import docker as dockerpy

nb_path='nbdocker_demo.ipynb'
with open(nb_path) as data_file:
    data = json.load(data_file)
    print(data)

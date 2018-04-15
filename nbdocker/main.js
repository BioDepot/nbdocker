define([
    'require',
    'base/js/namespace',
    'base/js/dialog',
    'base/js/utils',
    'base/js/events',
    'notebook/js/cell',
    'notebook/js/textcell',
    'notebook/js/codecell',
    'jquery',
    './progressbar',
    './xterm.js-2.9.2/xterm',
    './xterm.js-2.9.2/addons/fit/fit',
    './notify'
], function(require, IPython, dialog, utils, events, cell, textcell, codecell, $, ProgressBar, Terminal, fitAddon) {

    // Object for retrieve pull message
    function PullImage(image_name, image_version) {
        this.name = image_name;
        this.version = image_version;
        this.callback = null;
    }
    PullImage.prototype.onMessage = function(cb) {
        this.callback = cb;
    };
    PullImage.prototype.fetch = function() {
        // connect to /dockerpull, subscript events
        var pullUrl = utils.url_path_join(IPython.notebook.base_url, "dockerpull");
        pullUrl = pullUrl + '/' + this.name + '/' + this.version;

        this.eventSource = new EventSource(pullUrl);
        var that = this;
        this.eventSource.addEventListener('message', function(event) {
            var data = JSON.parse(event.data);
            if (that.callback != undefined) {
                that.callback(data);
            }
        });
    };
    PullImage.prototype.close = function() {
        if (this.eventSource !== undefined) {
            this.eventSource.close();
        }
    };

    // Object for retrieve building message
    function BuildImage(uuid) {
        this.session_id = uuid;
        this.callback = null;
    };
    BuildImage.prototype.onMessage = function(cb) {
        this.callback = cb;
    };
    BuildImage.prototype.fetch = function() {
        // connect to /dockerbuild, subscript events
        var buildlUrl = utils.url_path_join(IPython.notebook.base_url, "dockerbuild");
        buildlUrl = buildlUrl + '/' + this.session_id;

        this.eventSource = new EventSource(buildlUrl);
        var that = this;
        this.eventSource.addEventListener('message', function(event) {
            var data = JSON.parse(event.data);
            if (that.callback != undefined) {
                that.callback(data);
            }
        });
    };
    BuildImage.prototype.close = function() {
        if (this.eventSource !== undefined) {
            this.eventSource.close();
        }
    };

    var ajax = utils.ajax || $.ajax;

    var service_url = utils.url_path_join(IPython.notebook.base_url, "docker");

    var load_css = function(name) {
        var link = document.createElement("link");
        link.type = "text/css";
        link.rel = "stylesheet";
        link.href = require.toUrl(name);
        document.getElementsByTagName("head")[0].appendChild(link);
    };

    // xterm.js object
    var logBuilding = new Terminal({
        convertEol: true,
        disableStdin: true
    });


    var template_tab = `
    <div class="col-sm-12" style="margin-bottom: 4px;">
        <div class="col-sm-7 row">
            <div class="input-group">
                <span class="input-group-addon">Image</span>
                <input type="text" class="form-control col-sm-7" id="docker_image" placeholder="e.g. biodepot/bwb:latest"> 
                <span class="input-group-btn">
                    <button class="btn btn-default btn-primary" type="button" id="pullImage">
                        <span class="fa fa-cloud-download"> Pull</span>
                    </button>
                </span>
            </div>
        </div>
        <div class="col-sm-5">
            <p class="text-primary text-right" id="infoTitle"/>
        </div>
    </div>
    <div class="col-sm-12 progressbar my-2" id="progress_container" style="height: 16px; display: none; ">
        <p id="progress_info"></p>
    </div>
    <div class="col-sm-12 progress_info" style="display: none;">
    </div>
    <ul class="nav nav-tabs">
        <li class="active"><a data-toggle="tab" href="#Containers" id="showContainers">Containers</a></li>
        <li><a data-toggle="tab" href="#Images" id="showImages">Images</a></li>
        <li><a data-toggle="tab" href="#Build">Build</a></li>
        <li><a data-toggle="tab" href="#HistoryView" id="showHistories">History</a></li>
    </ul>

    <div class="tab-content">
        <div id="Containers" class="tab-pane fade in active">  
        <p>Loading...</p>     
        </div>
        <div id="Images" class="tab-pane fade">
        <p>Loading...</p>
        </div>
        <div class="container-fluid tab-pane fade" id="Build">
            <div class="row content">
                <div class="col-sm-12" id="build_left">
                    <div class="form-group">
                        <label for="b_img_name">Image name:</label>
                        <input type="text" class="form-control" id="b_img_name">
                    </div>
                    <div class="form-group">
                        <label for="b_docker_file">Docker file:</label>
                        <textarea class="form-control" rows="20" id="b_docker_file"></textarea>
                    </div>
                </div>
                <div class="col-sm-12 log-terminal" id="build-logs" style="display:none;">
                </div>
                <div class="col-sm-12">
                    <button class="btn btn-default btn-primary" type="button" id="buildImage">
                        <span class="fa fa-wrench"> Build</span>
                    </button>
                    <button class="btn btn-default btn-primary" type="button" id="view_build_logs">
                        <span class="fa fa-history" aria-hidden="true"> logs</span>
                    </button>
                </div>
            </div>
        </div>
        <div class="tab-pane fade" id="HistoryView">
            <div class="col-sm-12">
            </div>
            <div id="History">
                <p>Loading...</p>
            </div>
        </div>
    </div>
    `;

    var template_container = `
    <table class="table table-striped table-hover">
        <thead><tr>
        <th width=6%>#</th>
        <th width=8%>Container Id</th>
        <th width=20%>Image</th>
        <th width=46%>Mounts</th>
        <th width=20%>Ports</th>
        <th width=10%>Status</th>
        </tr></thead>
    <tbody>
    <% _.each(containers, function(container){ %>
        <tr>
        <td>
            <a class="btn btn-danger remove_container" href="javascript:void(0)" container-id="<%= container["Id"] %>">
            <i class="fa fa-trash" aria-hidden="true" container-id="<%= container["Id"] %>"></i></a>
        </td>
        <td><%= container["Id"].substring(0,12) %></td>
        <td><%= container["Image"] %></td>
        <td><%= container["Mounts"] %></td>
        <td><%= container["Ports"] %></td>
        <td><%= container["Status"] %></td>
        </tr>
    <% }); %>
    </tbody>
    </table>`;
    var ListContainer = function(containers) {
        containers.forEach(function(container) {
            var mountStr = '';
            // format Volume Mounts to string
            container["Mounts"].forEach(function(volume) {
                if (mountStr != '') { mountStr += "</BR>"; }
                var source = volume["Source"];
                if (volume["Name"]) {
                    source = volume["Name"];
                }
                if (source.length > 32) { source = source.substring(0, 32) }
                mountStr += source;
                mountStr += "->" + volume["Destination"];
            });
            container["Mounts"] = mountStr;
            var portStr = '';
            // format Ports to string
            container["Ports"].forEach(function(port) {
                if (portStr != '') { portStr += "</BR>"; }
                if (port["IP"]) { portStr += port["IP"]; }
                if (port["PublicPort"]) { portStr += ":" + port["PublicPort"] + "->"; }
                portStr += port["PrivatePort"] + "/" + port["Type"];
            });
            container["Ports"] = portStr;
        });

        return _.template(template_container)({ containers: containers });
    };

    var template_images = `
    <% 
        HumanSize = function (bytes) { 
            if (bytes == 0) { return "0.00 B"; } 
            var e = Math.floor(Math.log(bytes) / Math.log(1024)); 
            return (bytes/Math.pow(1024, e)).toFixed(2)+" "+" KMGTP".charAt(e)+"iB";
        };

        SplitTag = function(RepoTag){
            var tag_name = RepoTag
            var tag_version = "<none>"
            if(RepoTag.indexOf(":") != -1){
                tag_name = RepoTag.split(":")[0];
                tag_version = RepoTag.split(":")[1];
            }
            return [tag_name, tag_version]
        };
    %>
    <table class="table table-hover" id="image_table">
        <thead>
            <tr>
                <th width=5%>#</th>
                <th width=6%>Image Id</th>
                <th width=25%>Repository</th>
                <th width=30%>Tag</th>
                <th width=12%>Size</th>
                <th width=20%>Created</th>
            </tr>
        </thead>
        <tbody>
            <% _.each(images, function(image){ %>
                <% if(image["RepoTags"] ){ %>
                <tr>
                    <td>
                        <a class="create_container" href="javascript:void(0)">
                        <i class="fa fa-plus" aria-hidden="true" image-id="<%= image["RepoTags"][0] %>"></i></a>
                    </td>
                    <td><%= image["Id"].substring(7,19) %></td>
                    <td><%= SplitTag(image["RepoTags"][0])[0] %></td>
                    <td><%= SplitTag(image["RepoTags"][0])[1] %></td>
                    <td><%= HumanSize(image["Size"]) %> </td>
                    <td><%= moment.unix(image["Created"]).format("YYYY-MM-DD HH:mm:ss") %></td>
                </tr>
            <% }}); %>
        </tbody>
    </table>
    `;
    var ListImages = function(images) {
        return _.template(template_images)({ images: images });
    };

    /*
    "host": $(this).find('#host_dir').val(),
                            "container": $(this).find('#container_dir').val(),
                            "external": $(this).find('#external_port').val(),
                            "internal": $(this).find('#internal_port').val(),
                            "command": $(this).find('#container_command').val(),
                            "image": image_name,
    */
    var template_history = `
    <table class="table table-striped table-hover">
        <thead><tr>
        <th width=15%>#</th>
        <th width=25%>Image</th>
        <th width=60%>Others</th>
        </tr></thead>
    <tbody>
    <% _.each(histories, function(record, idx){ %>
        <tr>
        <td>
            <span><b>#<%= idx%></b></span><a class="btn remove_record" href="javascript:void(0)" record-id="<%= record["Id"] %>">
            <i class="fa fa-trash" aria-hidden="true" record-id="<%= record["Id"] %>"></i></a>
            <a class="btn rerun_record" href="javascript:void(0)" record-id="<%= record["Id"] %>">
            <i class="fa fa-play" aria-hidden="true" record-id="<%= record["Id"] %>"></i></a>
        </td>
        <td><%= record["image"] %></td>
        <td><%= record["Mounts"]%><br/><%= record["Ports"] %><br/><%= record["command"]%></td>
        </tr>
    <% }); %>
    </tbody>
    </table>`;
    var ListHistories = function(histories) {
        histories.forEach(function(record) {
            record["Mounts"] = record["host"] + "->" + record["container"];
            record["Ports"] = record["external"] + ":" + record["internal"];
        });

        return _.template(template_history)({ histories: histories });
    }

    var CreateContainer = function(image_name, start_options, fn_ready_create) {
        var create_container_template = `
            <div class="panel panel-info">
                <div class="panel-heading">
                    <h3 class="panel-title"><%= image_id %></h3>
                </div>
                <div class="panel-body">
                    <form>
                        <div class="form-control-static">Mapping directory</div>
                        <div class="form-group row">
                            <div class="input-group col-sm-10">
                                <span class="input-group-addon">host</span>
                                <input type="text" class="form-control" id="host_dir" placeholder="e.g. /home/user/data">
                            </div>
                            <i class="fa fa-arrow-down" aria-hidden="true"></i>
                            <div class="input-group col-sm-10">
                                <span class="input-group-addon">container</span>
                                <input type="text" class="form-control" id="container_dir" placeholder="e.g. /path/in/container">
                            </div>
                        </div>
                        <div class="form-control-static">Ports:</div>
                        <div class="col-sm-12 form-inline form-group row">
                            <div class="input-group col-sm-5">
                                <label for="external_port" class="input-group-addon">external</label>
                                <input type="text" class="form-control" id="external_port" placeholder="e.g. 8888">
                            </div>
                            <div class="input-group col-sm-5">
                                <label for="internal_port" class="input-group-addon">internal</label>
                                <input type="text" class="form-control" id="internal_port" placeholder="e.g. 8888">
                            </div>
                        </div>
                        <div class="form-control-static row">Command</div>
                        <div class="form-group col-sm-12">
                            <textarea class="form-control" id="container_command" rows="6" placeholder="e.g. samtools view -bS SRR1039508.sam" required/>
                        </div>
                    </form>
                </div>
            </div>`

        var elements = $('<div/>').append(
            $("<p/>").html(_.template(create_container_template)({ image_id: image_name })));

        var mod = dialog.modal({
            title: "Create Container",
            body: elements,
            buttons: {
                "Cancel": {},
                "Create": {
                    class: "btn-primary",
                    click: function() {
                        var obj = {
                            "host": $(this).find('#host_dir').val(),
                            "container": $(this).find('#container_dir').val(),
                            "external": $(this).find('#external_port').val(),
                            "internal": $(this).find('#internal_port').val(),
                            "command": $(this).find('#container_command').val(),
                            "image": image_name,
                        };
                        fn_ready_create(obj);
                    }
                }
            },
            notebook: IPython.notebook,
            keyboard_manager: IPython.notebook.keyboard_manager,
            open: function(event, ui) {
                var that = $(this);
                var host_dir = that.find('#host_dir');
                var container_dir = that.find('#container_dir');
                var port_internal = that.find('#internal_port');
                var port_external = that.find('#external_port');
                var commands = that.find('#container_command');
                if(!_.isEmpty(start_options)){
                    host_dir.val(start_options['host']);
                    container_dir.val(start_options['container']);
                    port_internal.val(start_options['internal']);
                    port_external.val(start_options['external']);
                    commands.val(start_options['command']);
                };
                that.find('#container_command').keypress(function(e, ui) {
                    if (e.which == 13) {
                        that.find('.btn-primary').first().click();
                        return false;
                    }
                });
                container_dir.focus();
            }
        });
    };

    var RemoveContainer = function(container_id, fn_confirmed) {
        var elements = $('<div/>').append(
            $("<p/>").html('<p class="bootbox-body">You are going to kill and remove the container: </p><p>' + container_id + "</p>"));

        var dlg = dialog.modal({
            title: "Remove Container",
            body: elements,
            buttons: {
                "Cancel": {},
                "Remove": {
                    label: '<i class="fa fa-trash"></i> Remove',
                    class: "btn-danger",
                    click: function() {
                        fn_confirmed(container_id)
                    }
                }
            },
        });
    };

    var docker_widget = {
        help: 'Manage your docker container inside the Notebook',
        icon: 'docker-icon',
        help_index: '',
        handler: function(env) {
            var div = $('<div/>');
            div.append(template_tab);

            function on_ok() {};

            // ajax request to create container
            function create_container(options) {
                options["notebookname"] = IPython.notebook.notebook_path;
                console.log(options);
                var docker_create_container = {
                    type: "POST",
                    data: { cmd: "createcontainer", options: JSON.stringify(options) },
                    success: function(data, status) {
                        ajax(service_url, docker_list_container);
                    },
                    error: function(jqXHR, status, err) {
                        alert("create container failed: " + err);
                    }
                };
                ajax(service_url, docker_create_container);
            };

            // ajax request to remove container
            function remove_container(container_id) {
                var docker_remove_container = {
                    type: "POST",
                    data: { cmd: "removecontainer", container_id: container_id },
                    success: function(data, status) {
                        ajax(service_url, docker_list_container);
                    },
                    error: function(jqXHR, status, err) {
                        alert("remove container failed: " + err);
                    }
                };
                ajax(service_url, docker_remove_container);
            };

            // request to remove history
            function remove_history(record_id) {
                var docker_remove_history = {
                    type: "POST",
                    data: { cmd: "removehistory", record_id: record_id, notebook_name: IPython.notebook.notebook_path },
                    success: function(data, status) {
                        ajax(service_url, docker_list_histories);
                    }
                };
                ajax(service_url, docker_remove_history);
            };

            // request to rerun history
            function rerun_history(record_id) {
                var docker_rerun_history = {
                    type: "POST",
                    data: { cmd: "rereunhistory", record_id: record_id, notebook_name: IPython.notebook.notebook_path },
                    success: function(data, status) {
                        $('#showContainers').tab('show');
                        ajax(service_url, docker_list_container);
                    }
                };
                ajax(service_url, docker_rerun_history);
            };

            // ajax requst to submit a building
            function build_submit(image_name, docker_file) {
                var uuid = '';
                var docker_build_submit = {
                    type: "POST",
                    data: { cmd: "buildsubmit", image_name: image_name, docker_file: docker_file },
                    success: function(data, status) {
                        if ('uuid' in data) {
                            // submit successful, streaming logs....
                            stream_build_logs(data['uuid']);
                        } else {
                            logBuilding.write(data['message'] + '\n');
                        }
                    },
                    error: function(jqXHR, status, err) {
                        alert("submit build failed: " + err);
                    }
                };
                ajax(service_url, docker_build_submit);
            };

            // stream building logs
            function stream_build_logs(uuid) {
                console.log(uuid);
                var builder = new BuildImage(uuid);
                builder.onMessage(function(data) {
                    if (data.status !== undefined) {
                        if (data.status == 'Succeeded' || data.status == 'Failed') {
                            builder.close();

                            if (data.status == 'Succeeded') {
                                //ajax(service_url, docker_list_images);
                            }
                        }
                        logBuilding.write(data.status + '\n');
                    } else if (data.message != undefined) {
                        logBuilding.write(data.message);
                    } else {
                        logBuilding.write(data);
                    }
                });
                builder.fetch();
            };

            // request to save histories
            function on_save_history() {
                var docker_save_history = {
                    type: "POST",
                    data: { cmd: "savehistory", notebook_name: IPython.notebook.notebook_path },
                    success: function(data, status) {
                        console.log(data["message"]);
                    },
                    error: function(jqXHR, status, err) {
                        alert("save histories failed: " + err);
                    }
                };

                ajax(service_url, docker_save_history);
            };

            // ajax request to retrieve docker info
            var docker_info = {
                type: "POST",
                data: { cmd: "info" },
                success: function(data, status) {
                    console.log("get docker info succeeded: " + data);
                    var mem_bytes = data['MemTotal'];
                    var e = Math.floor(Math.log(mem_bytes) / Math.log(1024));
                    var memTotal = (mem_bytes / Math.pow(1024, e)).toFixed(2) + " " + " KMGTP".charAt(e) + "iB";
                    var info = "Docker Version: " + data['ServerVersion'] + " | CPU: " + data['NCPU'] + " | Memory: " + memTotal;
                    $('#infoTitle').text(info);
                },
                error: function(jqXHR, status, err) {
                    alert("get docker info failed: " + err);
                }
            };

            // ajax request to list containers
            var docker_list_container = {
                type: "POST",
                data: { cmd: "listcontainer" },
                success: function(data, status) {
                    $('#Containers').html(ListContainer(data['containers']));
                    $('tr a.remove_container').on('click', function(e) {
                        var container_id = $(e.target).attr('container-id');
                        RemoveContainer(container_id, remove_container);
                    });
                },
                error: function(jqXHR, status, err) {
                    alert("remove container failed: " + err);
                }
            };

            // ajax request to list images
            var docker_list_images = {
                type: "POST",
                data: { cmd: "listimage" },
                success: function(data, status) {
                    $('#Images').html(ListImages(data['images']));
                    $("tr a.create_container").on('click', function(e) {
                        var image_id = $(e.target).attr('image-id');
                        CreateContainer(image_id, {}, create_container);
                    });
                },
                error: function(jqXHR, status, err) {
                    alert("list images failed: " + err);
                }
            };

            // ajax request to list histories
            var docker_list_histories = {
                type: "POST",
                data: { cmd: "listhistory", notebook_name: IPython.notebook.notebook_path },
                success: function(data, status) {
                    $('#History').html(ListHistories(data['history']));
                    $('tr a.remove_record').on('click', function(e) {
                        var record_id = $(e.target).attr('record-id');
                        remove_history(record_id);
                    });
                    $('tr a.rerun_record').on('click', function(e) {
                        var record_id = $(e.target).attr('record-id');
                        rerun_history(record_id);
                    });
                    //if (data['history'].length > 0) {
                    //    $('.nav-tabs a[href="#HistoryView"]').tab('show');
                    //}
                },
                error: function(jqXHR, status, err) {
                    alert("list history failed: " + err);
                }
            };

            // MAIN dialog
            var dockerDialog = dialog.modal({
                body: div,
                title: 'Docker management',
                buttons: {
                    'Close': {
                        class: 'btn-primary btn-large',
                        click: on_ok
                    },
                },
                notebook: env.notebook,
                keyboard_manager: env.notebook.keyboard_manager,

                // event that main dialog is opening
                open: function(event, ui) {
                    ajax(service_url, docker_info);

                    // register event on click tabs( Containers | Images)
                    $('#showContainers').on('click', function() {
                        ajax(service_url, docker_list_container);
                    });
                    $('#showImages').on('click', function() {
                        ajax(service_url, docker_list_images);
                    });
                    $('#showHistories').on('click', function() {
                        ajax(service_url, docker_list_histories);
                    });

                    ajax(service_url, docker_list_container);
                    //ajax(service_url, docker_list_histories);

                    // progress bar instance for pulling image
                    var bar = new ProgressBar.Line('#progress_container', {
                        strokeWidth: 1,
                        easing: 'easeInOut',
                        duration: 1400,
                        color: '#5cb85c',
                        trailColor: '#eee',
                        trailWidth: 1,
                        text: {
                            style: {
                                // Text color.
                                color: '#999',
                                position: 'absolute',
                                right: '0',
                                top: '15px',
                                padding: 0,
                                margin: 0,
                                transform: null
                            },
                            autoStyleContainer: false
                        },
                        step: (state, bar) => {
                            bar.setText(Math.round(bar.value() * 100) + ' %');
                        }
                    });

                    // initialize xterm.js object
                    logBuilding.open(document.getElementById('build-logs'));
                    fitAddon.fit(logBuilding);

                    // event of click on [Pull] button
                    $('#pullImage').on('click', function() {
                        var repo = $('#docker_image').val();
                        var image_name = '';
                        var image_version = '';

                        repoTags = repo.split(':');
                        if (repoTags.length == 2) {
                            image_name = repoTags[0];
                            image_version = repoTags[1];
                        } else {
                            image_name = repo;
                            image_version = 'latest';
                        }

                        $('.progressbar').show();

                        // Pull events processor
                        var pull = new PullImage(image_name, image_version);
                        pull.onMessage(function(data) {
                            if (data.message !== undefined) {
                                var message_level = 'info';
                                if (data.message == 'Succeeded') { message_level = "success"; } else if (data.message == 'Failed') { message_level = "error"; }
                                if (data.message == 'Succeeded' || data.message == 'Failed' || data.message.indexOf('Image exists locally') != -1) {
                                    $('.progressbar').hide();
                                    pull.close();
                                    bar.set(0);
                                    $("#docker_image").notify(
                                        data.message, message_level, { position: "bottom" }
                                    );
                                    if (data.message == 'Succeeded') {
                                        ajax(service_url, docker_list_images);
                                    }
                                }
                                console.log(data.message);
                            } else if (data.progress != undefined) {
                                bar.animate(data.progress / 100.0);
                            } else {
                                console.log(data);
                            }
                        });

                        pull.fetch();
                    });

                    // event of click on [Build] button
                    $('#buildImage').on('click', function() {
                        var image_name = $('#b_img_name').val();
                        var docker_file = $('#b_docker_file').val();
                        $('#build_left').hide();
                        $('#build-logs').show();
                        fitAddon.fit(logBuilding);
                        build_submit(image_name, docker_file);
                    });

                    $('#view_build_logs').on('click', function() {
                        if ($('#build-logs').css('display') == 'none') {
                            $('#build_left').hide();
                            $('#build-logs').show();
                            fitAddon.fit(logBuilding);
                        } else {
                            $('#build-logs').hide();
                            $('#build_left').show();
                        }
                    });

                    $('#saveHistory').on('click', function() {
                        on_save_history();
                    });
                }
            });
            dockerDialog.find(".modal-content").attr('style', 'width: 900px');
        }
    }

    var render_cell = function(cell) {
        var element = cell.element.find('div.text_cell_render');
        var text = render_nbdocker(cell, element[0].innerHTML);
        if (text !== undefined) {
            element[0].innerHTML = text;
        }
    };

    /* force rendering of markdown cell if notebook is dirty */
    var original_render = textcell.MarkdownCell.prototype.render;
    textcell.MarkdownCell.prototype.render = function() {
        if (IPython.notebook.dirty === true) {
            this.rendered = false
        }
        console.log("nbdocker redirect render!")
        return original_render.apply(this)
    };

    var render_nbdocker = function(cell, text) {
        var nbdocker_button =
            `<button class="btn btn-default" onclick="IPython.notebook.events.trigger('nbdocker.run', {'record_id': '#{nbdocker_his_id}', 'cell_id': '#{cell_id}'})">
            <i class="docker-icon fa"></i>
            </button>`;
        var found = false;
        var newtext = text.replace(/{nbdocker#(.*?)}/g, function(match, tag, cha) {
            found = true;
            return nbdocker_button.replace("#{nbdocker_his_id}", tag).replace("#{cell_id}", cell.cell_id);
        });

        if (found)
            return newtext;

        clear_docker_run_status([cell]);

        return undefined
    };

    var update_md_cells = function() {
        var ncells = IPython.notebook.ncells();
        var cells = IPython.notebook.get_cells();
        for (var i = 0; i < ncells; i++) {
            var cell = cells[i];
            if (cell.cell_type == 'markdown') {
                render_cell(cell);
            }
        }
    };


    var dlgConfirmRunContainer = function(record_id, record_info, cell, fn_run_history) {
        var elements = $('<div/>').append(
            $("<p/>").html('<p class="bootbox-body">You are going to run history <b>#' + record_id.toString() + '</b>: </p><p style="text-indent: 10px;">' + record_info + "</p>"));

        var dlg_run_history = dialog.modal({
            title: "Run container from history #" + record_id.toString(),
            body: elements,
            buttons: {
                "Cancel": {},
                "Run": {
                    label: '<i class="fa fa-play"></i> Run',
                    class: "btn-primary",
                    click: function() {
                        fn_run_history(record_id, cell);
                    }
                }
            }
        });
    };

    function run_history_quiet(record_id, cell) {
        var docker_run_history_quiet = {
            type: "POST",
            data: { cmd: "rereunhistory", record_id: record_id, notebook_name: IPython.notebook.notebook_path },
            success: function(data, status) {
                var container = {
                    "id": data['container_id']['Id'].substring(0, 12),
                    "status": 'running...'
                };
                
                if (cell.metadata.DockerContainers === undefined){
                    cell.metadata.DockerContainers = {}
                }
                cell.metadata.DockerContainers[record_id.toString()] = container;
                update_docker_run_area(cell);
            }
        };
        console.log('Runing history #' + record_id);
        ajax(service_url, docker_run_history_quiet);
    };

    function run_container(options) {
        options["notebookname"] = IPython.notebook.notebook_path;
        console.log(options);
        var docker_create_container = {
            type: "POST",
            data: { cmd: "createcontainer", options: JSON.stringify(options) },
            success: function(data, status) {
                if (data['container_id'] == 'ImageNotFound'){
                    alert("The docker image [" + options['image'] + "] doesn't exist, please pull it first!");
                } else{
                    var container = {
                        "id": data['container_id']['Id'].substring(0, 12),
                        "status": 'running...'
                    };
                    
                    if (cell.metadata.DockerContainers === undefined){
                        cell.metadata.DockerContainers = {}
                    }
                    cell.metadata.DockerContainers[record_id.toString()] = container;
                    update_docker_run_area(cell);
                }
            },
            error: function(jqXHR, status, err) {
                alert("create container failed: " + err);
            }
        };
        ajax(service_url, docker_create_container);
    };

    function locate_cell(cell_id) {
        var cells = IPython.notebook.get_cells();
        for (var i = 0; i < cells.length; i++) {
            var cell = cells[i];

            if ((cell.cell_type === 'markdown') && cell.cell_id === cell_id) {
                return cell;
            }
        }
        return undefined
    }

    function OnRunHistory(event, data) {
        cell_id = data['cell_id'];
        record_id = data['record_id'];
        console.log('run history record id:' + record_id);

        cell = locate_cell(cell_id);
        var docker_get_history = {
            type: "POST",
            data: { cmd: "gethistory", record_id: record_id, notebook_name: IPython.notebook.notebook_path },
            success: function(data, status) {}
        };

        $.when(ajax(service_url, docker_get_history)).done(function(response) {
            //const max_cmd_length = 30;

            record_detail = response['history'];
            command = record_detail['command'];
            record_info = "Image: " + record_detail['image'] + "</br>" + "Commands: " + command;

            //dlgConfirmRunContainer(record_id, record_info, cell, run_history_quiet);
            CreateContainer(record_detail['image'], record_detail, run_container);
        });

    };

    function OnRefreshCellContainer(event, info) {
        cell_id = info['cell_id'];

        cell = locate_cell(cell_id);

        var docker_get_container_status = {
            type: "POST",
            data: { cmd: "containerstatus", containers: JSON.stringify(cell.metadata.DockerContainers) },
            success: function(data, status) {
                cell.metadata.DockerContainers = data['containers'];
                //console.log(cell.metadata.DockerContainers);
                update_docker_run_area(cell);
            }
        };
        ajax(service_url, docker_get_container_status);

    }

     // request to save histories
     function OnSaveHistory(event, info) {
        var docker_save_history = {
            type: "POST",
            data: { cmd: "savehistory", notebook_name: IPython.notebook.notebook_path },
            success: function(data, status) {
                console.log(data["message"]);
            },
            error: function(jqXHR, status, err) {
                alert("save histories failed: " + err);
            }
        };

        ajax(service_url, docker_save_history);
    };

    // Runing status indicator

    function clear_docker_run_status(cells) {
        cells.forEach(function(cell, idx, arr) {
            delete cell.metadata.DockerContainers;
            cell.element.find('.message_area').remove();
        });
        events.trigger('set_dirty.Notebook', { value: true });
    }

    function clear_docker_run_status_all() {
        clear_docker_run_status(Jupyter.notebook.get_cells());
    }

    function update_docker_run_area(cell) {
        if (!(cell.cell_type === 'markdown') || !cell.metadata.DockerContainers) {
            return $();
        }

        var docker_area = cell.element.find('.message_area');
        if (docker_area.length < 1) {
            var refresh_button = `
            <div> 
            <button class='btn btn-sm' id='refresh' onclick="IPython.notebook.events.trigger('nbdocker.refresh', {'cell_id': '#{cell_id}'})">
                <i class='fa fa-refresh' aria-hidden='true'></i>
            </button>
            </div>`;
            refresh_button = refresh_button.replace("#{cell_id}", cell.cell_id);

            docker_area = $('<div/>')
                .addClass('message_area')
                .append($('<div/>').html(refresh_button))
                .append($('<div/>').addClass('container_info'))
                //.appendTo(cell.element.find('.text_cell_render'));
                .appendTo(cell.element.find('.inner_cell'));
        }

        var docker_subarea = cell.element.find('.container_info');

        var container_html = "";
        for (var key in cell.metadata.DockerContainers) {
            var msg = "<p>History #${record_id}: docker container [${container_id}] -- ${container_status}</p>";

            var ccc = cell.metadata.DockerContainers[key];

            msg = msg.replace("${record_id}", key);
            msg = msg.replace("${container_id}", ccc['id']);
            msg = msg.replace("${container_status}", ccc['status']);

            container_html = container_html + msg;
        }

        docker_subarea.html(container_html);
        return docker_area;
    }


    function load_ipython_extension() {
        load_css('./main.css');
        load_css('./xterm.js-2.9.2/xterm.css');

        console.info('Loaded Jupyter extension: nbdocker -- Docker for Jupter Notebook');

        // register new action
        var action_name = IPython.keyboard_manager.actions.register(docker_widget, 'manager', 'jupyter-docker');
        // add button to toolbar
        IPython.toolbar.add_buttons_group(['jupyter-docker:manager']);

        events.on("rendered.MarkdownCell", function(event, data) {
            render_cell(data.cell);
        });

        events.on("kernel_ready.Kernel", function() {
            if (Jupyter.notebook !== undefined && Jupyter.notebook._fully_loaded) {
                console.info('Kernel Ready: render md cells');
                update_md_cells();
            }
        });

        events.on("notebook_loaded.Notebook", function() {
            console.info('Notebook loaded: render md cells');
            update_md_cells();
        });

        events.on("nbdocker.run", function(event, data) {
            OnRunHistory(event, data);
        });

        events.on("nbdocker.refresh", function(event, info) {
            OnRefreshCellContainer(event, info);
        });

        events.on("notebook_saved.Notebook", function(event, info){
            console.info("notebook saved!");
            OnSaveHistory(event, info);
        });

    }

    return { load_ipython_extension: load_ipython_extension };
})
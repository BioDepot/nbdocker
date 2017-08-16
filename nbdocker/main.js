define([
    'base/js/namespace',
    'base/js/dialog',
    'base/js/utils',
    'jquery',
    'require'
], function(IPython, dialog, utils, $, require) {

    var ajax = utils.ajax || $.ajax;

    var service_url = utils.url_path_join(IPython.notebook.base_url, "docker");

    var load_css = function(name) {
        var link = document.createElement("link");
        link.type = "text/css";
        link.rel = "stylesheet";
        link.href = require.toUrl(name);
        document.getElementsByTagName("head")[0].appendChild(link);
    };

    var template_tab = `
    <div class="col-sm-12">
        <p class="text-primary text-right" id="infoTitle"/>
    </div>
    <ul class="nav nav-tabs">
        <li class="active"><a data-toggle="tab" href="#Containers" id="showContainers">Containers</a></li>
        <li><a data-toggle="tab" href="#Images" id="showImages">Images</a></li>
        <li><a data-toggle="tab" href="#menu2">Build</a></li>
    </ul>

    <div class="tab-content">
        <div id="Containers" class="tab-pane fade in active">  
        <p>Loading...</p>     
        </div>
        <div id="Images" class="tab-pane fade">
        <p>Loading...</p>
        </div>
        <div id="menu2" class="tab-pane fade">
        <h3>Menu 2</h3>
        <p>Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam.</p>
        </div>
    </div>
    `;

    var template_container = `
    <table class="table table-striped table-hover">
        <thead><tr>
        <th width=6%>#</th>
        <th width=6%>Container Id</th>
        <th width=20%>Image</th>
        <th>Mounts</th>
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
            container["Mounts"].forEach(function(volume) {
                if (mountStr != '') { mountStr += "</BR>"; }
                if (volume["Name"]) { mountStr += volume["Name"]; } else { mountStr += volume["Source"]; }
                mountStr += "->" + volume["Destination"];
            });
            container["Mounts"] = mountStr;
            var portStr = '';
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
        }
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
                <tr>
                    <td>
                        <a class="create_container" href="javascript:void(0)">
                        <i class="fa fa-plus" aria-hidden="true" image-id="<%= image["RepoTags"][0] %>"></i></a>
                    </td>
                    <td><%= image["Id"].substring(7,19) %></td>
                    <td><%= image["RepoTags"][0].split(":")[0] %></td>
                    <td><%= image["RepoTags"][0].split(":")[1] %></td>
                    <td><%= HumanSize(image["Size"]) %> </td>
                    <td><%= moment.unix(image["Created"]).format("YYYY-MM-DD HH:mm:ss") %></td>
                </tr>
            <% }); %>
        </tbody>
    </table>
    `;
    var ListImages = function(images) {
        return _.template(template_images)({ images: images });
    };

    var CreateContainer = function(image_name, fn_ready_create) {
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
                        <div class="form-group col-sm-12 row">
                            <input type="text" class="form-control" id="container_command" placeholder="e.g. samtools view -bS SRR1039508.sam ">
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
            open: function(event, ui) {
                var that = $(this);
                var container_dir = that.find('#container_dir');
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
                Remove: {
                    label: '<i class="fa fa-trash"></i> Remove',
                    class: "btn-danger",
                    click: fn_confirmed(container_id)
                }
            },
        });
    };

    var docker_widget = {
        help: 'Manage your docker container inside the Notebook',
        icon: 'docker-icon',
        help_index: '',
        handler: function(env) {
            var on_success = undefined;
            var on_error = undefined;

            var div = $('<div/>');

            div.append(template_tab);

            // get the canvas for user feedback
            var container = $('#notebook-container');

            function on_ok() {
                // display preloader
                //var preloader = '<img class="commit-feedback" src="https://cdnjs.cloudflare.com/ajax/libs/slick-carousel/1.5.8/ajax-loader.gif">';
                // container.prepend(preloader);
            };

            function create_container(options) {
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

            var docker_info = {
                type: "POST",
                data: { cmd: "info" },
                success: function(data, status) {
                    console.log("get docker info succeeded: " + data);
                    var mem_bytes = data['MemTotal'];
                    var e = Math.floor(Math.log(mem_bytes) / Math.log(1024));
                    var memTotal = (mem_bytes / Math.pow(1024, e)).toFixed(2) + " " + " KMGTP".charAt(e) + "iB";
                    var info = "Docker Version: " + data['ServerVersion'] + " | CPU: " + data['NCPU'] + " | Memory: " + memTotal;
                    $('#infoTitle').text(info)

                },
                error: function(jqXHR, status, err) {
                    alert("get docker info failed: " + err);
                }
            };
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
            var docker_list_images = {
                type: "POST",
                data: { cmd: "listimage" },
                success: function(data, status) {
                    $('#Images').html(ListImages(data['images']));
                    $("tr a.create_container").on('click', function(e) {
                        var image_id = $(e.target).attr('image-id');
                        CreateContainer(image_id, create_container);
                    });
                },
                error: function(jqXHR, status, err) {
                    alert("list images failed: " + err);
                }
            };

            var dockerDialog = dialog.modal({
                body: div,
                title: 'Docker management',
                buttons: {
                    'Close': {
                        class: 'btn-primary btn-large',
                        click: on_ok
                    }
                },
                notebook: env.notebook,
                keyboard_manager: env.notebook.keyboard_manager,
                open: function(event, ui) {
                    ajax(service_url, docker_info);

                    $('#showContainers').on('click', function() {
                        ajax(service_url, docker_list_container);
                    });
                    $('#showImages').on('click', function() {
                        ajax(service_url, docker_list_images);
                    });

                    ajax(service_url, docker_list_container);
                }
            });
            dockerDialog.find(".modal-content").attr('style', 'width: 900px');
        }
    }

    function load_ipython_extension() {

        load_css('./main.css');
        // log to console
        console.info('Loaded Jupyter extension: Docker for Jupter Notebook')

        // register new action
        var action_name = IPython.keyboard_manager.actions.register(docker_widget, 'manager', 'jupyter-docker')
            // add button for new action
        IPython.toolbar.add_buttons_group(['jupyter-docker:manager'])

    }

    return { load_ipython_extension: load_ipython_extension };
})
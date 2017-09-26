var widgets = require('@jupyter-widgets/base');
var _ = require('underscore');

var DockerModel = widgets.DOMWidgetModel.extend({
    defaults: _.extend(widgets.DOMWidgetModel.prototype.defaults(), {
        _model_name: 'DockerModel',
        _view_name: 'DockerView',
        _model_module: 'ipydocker',
        _view_module: 'ipydocker',
        _model_module_version: '0.1.0',
        _view_module_version: '0.1.0',
    })
});

var iModal = function(options) {
    var modal = $("<div/>")
        .addClass("modal")
        .addClass("fade")
        .attr("role", "dialog");
    var dialog = $("<div/>")
        .addClass("modal-dialog")
        .appendTo(modal);
    var dialog_content = $("<div/>")
        .addClass("modal-content")
        .appendTo(dialog);
    if (typeof(options.body) === 'string' && options.sanitize !== false) {
        options.body = $("<p/>").text(options.body);
    }
    dialog_content.append(
        $("<div/>")
        .addClass("modal-header")
        .mousedown(function() {
            $(".modal").draggable({ handle: '.modal-header' });
        })
        .append($("<button>")
            .attr("type", "button")
            .addClass("close")
            .attr("data-dismiss", "modal")
            .attr("aria-hidden", "true")
            .html("&times;")
        ).append(
            $("<h4/>")
            .addClass('modal-title')
            .text(options.title || "")
        )
    ).append(
        $("<div/>")
        .addClass("modal-body")
        .append(
            options.body || $("<p/>")
        )
    );

    var footer = $("<div/>").addClass("modal-footer");

    var default_button;

    for (var label in options.buttons) {
        var btn_opts = options.buttons[label];
        var button = $("<button/>")
            .addClass("btn btn-default btn-sm")
            .attr("data-dismiss", "modal")
            .text(label);
        if (btn_opts.id) {
            button.attr('id', btn_opts.id);
        }
        if (btn_opts.click) {
            button.click($.proxy(btn_opts.click, dialog_content));
        }
        if (btn_opts.class) {
            button.addClass(btn_opts.class);
        }
        footer.append(button);
        if (options.default_button && label === options.default_button) {
            default_button = button;
        }
    }
    if (!options.default_button) {
        default_button = footer.find("button").last();
    }
    dialog_content.append(footer);
    // hook up on-open event
    modal.on("shown.bs.modal", function() {
        setTimeout(function() {
            default_button.focus();
            if (options.open) {
                $.proxy(options.open, modal)();
            }
        }, 0);
    });

    // destroy modal on hide, unless explicitly asked not to
    if (options.destroy === undefined || options.destroy) {
        modal.on("hidden.bs.modal", function() {
            modal.remove();
        });
    }
    modal.on("hidden.bs.modal", function() {
        if (options.notebook) {
            var cell = options.notebook.get_selected_cell();
            if (cell) cell.select();
        }
        if (options.keyboard_manager) {
            options.keyboard_manager.enable();
            options.keyboard_manager.command_mode();
        }
    });

    if (options.keyboard_manager) {
        options.keyboard_manager.disable();
    }

    if (options.backdrop === undefined) {
        options.backdrop = 'static';
    }

    return modal.modal(options);
};

var RemoveContainer = function(container_id, fn_confirmed) {
    var elements = $('<div/>').append(
        $("<p/>").html('<p class="bootbox-body">You are going to kill and remove the container: </p><p>' + container_id + "</p>"));

    var dlg = iModal({
        title: "Remove Container",
        keyboard_manager: Jupyter.keyboard_manager,
        body: elements,
        buttons: {
            "Cancel": {},
            Remove: {
                label: '<i class="fa fa-trash"></i> Remove',
                class: "btn-danger",
                click: fn_confirmed
            }
        },
    });
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

    // console.log(image_name);
    var elements = $('<div/>').append(
        $("<p/>").html(_.template(create_container_template)({ image_id: image_name })));

    var mod = iModal({
        title: "Create Container",
        keyboard_manager: Jupyter.keyboard_manager,
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
            Jupyter.keyboard_manager.disable();
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

var toolbar = Backbone.View.extend({
    render: function() {
        var toolbar_template = `
            <div class="row">
            <div class="btn-group col-sm-9">
                <button class="btn btn-default" id="refresh">
                    <i class="fa fa-refresh" aria-hidden="true"></i>
                </button>
                <button class="btn btn-default" id="containers">Containers</button> 
                <button class="btn btn-default" id="images">Images</button> 
            </div>
            `;

        //this.model.set('command', 'info');
        //this.touch();
        //var info = this.model.get('docker_info');
        //var mem_bytes = info['MemTotal'];
        //var e = Math.floor(Math.log(mem_bytes) / Math.log(1024));
        //var memTotal = (mem_bytes / Math.pow(1024, e)).toFixed(2) + " " + " KMGTP".charAt(e) + "iB";
        this.$el.html(toolbar_template);
        //this.$el.html(_.template(toolbar_template)({
        //    version: info['ServerVersion'],
        //    cpu: info['NCPU'],
        //    mem: memTotal,
        //}));
        return this;
    },
});

var containerListView = Backbone.View.extend({
    render: function() {
        var container_template = `
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

        var containerList = this.model.get('containers');
        containerList.forEach(function(container) {
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

        var html = _.template(container_template);
        this.$el.html(html({ containers: containerList }));
        return this;
    },
});

var imageListView = Backbone.View.extend({
    render: function() {
        var image_template = `
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
            </table>`

        var imageList = this.model.get('images');
        var html = _.template(image_template);
        this.$el.html(html({ images: imageList }));
        return this;
    }
});

var DockerView = widgets.DOMWidgetView.extend({

    events: {
        "click #containers": "onListContainer",
        "click #images": "onListImages",
        "click #refresh": "onRefresh",
        "click tr a.create_container": "onNewContainer",
        "click tr a.remove_container": "onRemoveContainer",
    },

    initialize: function() {
        DockerView.__super__.initialize.apply(this, arguments);
        this.listenTo(this.model, 'sync', this.render);
        this.model.on('change:containers', this.onContainerChanged, this);
        this.model.on('change:images', this.onImagesChanged, this);
        this.container_view = null;
    },

    onListContainer: function() {
        this.model.set('command', 'ps');
        this.touch();
    },

    onListImages: function() {
        this.model.set('command', 'images');
        this.touch();
    },

    onRefresh: function() {
        var lastCmd = '';
        if (this.currentView == "container") { lastCmd = 'ps'; } else if (this.currentView == "images") { lastCmd = 'images'; }

        this.model.set('command', '');
        this.touch();
        this.model.set('command', lastCmd);
        this.touch();
    },

    onRemoveContainer: function(e) {
        var container_id = $(e.target).attr('container-id');
        var that = this;
        RemoveContainer(container_id, function(e) {
            that.model.set('parameters', { containerId: container_id });
            that.model.set('command', 'remove');
            that.touch();
        });
    },

    onNewContainer: function(e) {
        var image_id = $(e.target).attr('image-id');
        var that = this;
        CreateContainer(image_id, function(options) {
            that.model.set('parameters', options);
            that.model.set('command', 'create');
            that.touch();
        });
    },

    onContainerChanged: function() {
        if (!this.table_view) { delete this.table_view; }
        this.table_view = new containerListView({ model: this.model });
        this.currentView = 'container';
        this.render();
    },

    onImagesChanged: function() {
        var images = this.model.get('images');
        // console.log(images);
        if (!this.table_view) { delete this.table_view; }
        this.table_view = new imageListView({ model: this.model });
        this.currentView = 'images';
        this.render();
    },

    // Render the view.
    render: function() {
        this.$el.empty();
        this.$el.append(new toolbar({ model: this.model }).render().el);
        if (this.table_view) {
            this.$el.append(this.table_view.render().el);
        };
    },
});

module.exports = {
    DockerModel: DockerModel,
    DockerView: DockerView
};
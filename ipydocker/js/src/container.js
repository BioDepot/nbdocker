var widgets = require('@jupyter-widgets/base');
var _ = require('underscore');

var ContainerModel = widgets.DOMWidgetModel.extend({
    defaults: _.extend(widgets.DOMWidgetModel.prototype.defaults(), {
        _model_name: 'ContainerModel',
        _view_name: 'ContainerView',
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

var ContainerView = widgets.DOMWidgetView.extend({

    events: {
        "click #containers": "onListContainer",
        "click a.remove_container": "onRemoveContainer",
    },

    initialize: function() {
        ContainerView.__super__.initialize.apply(this, arguments);
        this.listenTo(this.model, 'sync', this.render);
        this.model.on('change:status', this.onStatusChanged, this);
    },

    onRemoveContainer: function(e) {
        var container_id = $(e.target).attr('container-id');
        var that = this;
        RemoveContainer(container_id, function(e) {
            that.model.set('ctl_command', 'remove');
            that.touch();
        });
    },

    onStatusChanged: function() {
        var status = this.model.get("status");
        console.log(status);
        if (status == "Stopped") {
            $("#control_bar").hide();
            $(".status").text(status);
        }
    },

    // Render the view.
    render: function() {
        var title = this.model.get("image");
        var status = this.model.get("status");
        var container_id = this.model.get("container_id");

        var panel = $("<div/>").addClass("panel").addClass("panel-info");
        var panel_header = $("<div/>")
            .addClass("panel-heading")
            .append(
                $("<h3/>").addClass("panel-title").text(title)
            ).appendTo(panel);
        var panel_body = $("<div/>").addClass("panel-body").appendTo(panel);

        var control_bar = $("<div/>").attr("id", "control_bar")
            .addClass("control")
            .html("<a class=\"btn btn-danger remove_container\" href=\"javascript:void(0)\" container-id=" + container_id + ">" +
                "<i class=\"fa fa-stop\" aria-hidden=\"true\" container-id=" + container_id + "></i></a>")
            .appendTo(panel_body);

        var status_p = $("<p/>").addClass("status").text(status).appendTo(panel_body);

        this.$el.html(panel.get(0));
    },
});

module.exports = {
    ContainerModel: ContainerModel,
    ContainerView: ContainerView
};
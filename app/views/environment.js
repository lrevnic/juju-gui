'use strict';

YUI.add('juju-view-environment', function(Y) {

var views = Y.namespace('juju.views'),
    Templates = views.Templates;

var EnvironmentView = Y.Base.create('EnvironmentView', Y.View, [views.JujuBaseView], {
    events: {
        '#add-relation-btn': {click: 'add_relation'},
        '#zoom-out-btn': {click: 'zoom_out'},
        '#zoom-in-btn': {click: 'zoom_in'}
    },

    initializer: function () {
        console.log('View: Initialized: Env');
        this.publish('showService', {preventable: false});
    },

    render: function () {
        console.log('View: Render: Env');
        var container = this.get('container');
        EnvironmentView.superclass.render.apply(this, arguments);
        container.setHTML(Templates.overview());
        this.render_canvas();
        return this;
    },

    render_canvas: function(){
        var self = this,
            container = this.get('container'),
            m = this.get('domain_models'),
            height = 600,
            width = 640;

        var services = m.services.toArray().map(function(s) {
            s.value = s.get('unit_count');
            return s;
        });
        var relations = m.relations.toArray();
        var fill = d3.scale.category20();

        var xscale = d3.scale.linear()
            .domain([-width / 2, width / 2])
            .range([2, width]);

        var yscale = d3.scale.linear()
            .domain([-height / 2, height / 2])
            .range([height, 0]);

        // Create a pan/zoom behavior manager.
        var zoom = d3.behavior.zoom()
            .x(xscale)
            .y(yscale)
            .scaleExtent([0.25, 1.75])
            .on('zoom', function() {
                self.rescale(vis, d3.event);
            });
        self.set('zoom', zoom);

        // Scales for unit sizes.
        // XXX magic numbers will have to change; likely during
        // the UI work
        var service_scale_width = d3.scale.log().range([164, 200]);
        var service_scale_height = d3.scale.log().range([64, 100]);

        // Set up the visualization with a pack layout.
        var vis = d3.select(container.getDOMNode())
            .selectAll('#canvas')
            .append('svg:svg')
            .attr('pointer-events', 'all')
            .append('svg:g')
            .call(zoom)
            .append('g');
        vis.append('svg:rect')
            .attr('fill', 'white')
            .on('click', function() {
                self.removeSVGClass('.service-control-panel.active', 'active');
            });

        // Bind visualization resizing on window resize
        Y.on('windowresize', function() {
            self.setSizesFromViewport(vis, container, xscale, yscale);
        });

        // If the view is bound to the dom, set sizes from viewport
        if (Y.one('svg')) {
            self.setSizesFromViewport(vis, container, xscale, yscale);
        }

        var tree = d3.layout.pack()
            .size([width, height])
            .padding(200);

        var rel_data = processRelations(relations);

        function update_links() {
            var link = vis.selectAll('polyline.relation')
                .remove();
            link = vis.selectAll('polyline.relation')
                .data(rel_data);
            link.enter().insert('svg:polyline', 'g.service')
                .attr('class', 'relation')
                .attr('points', function(d) { return self.draw_relation(d); });
        }

        var drag = d3.behavior.drag()
            .on('drag', function(d,i) {
                d.x += d3.event.dx;
                d.y += d3.event.dy;
                d3.select(this).attr('transform', function(d,i){
                    return 'translate(' + [ d.x,d.y ] + ')';
                });
                update_links();
            });

        // Generate a node for each service, draw it as a rect with
        // labels for service and charm.
        var node = vis.selectAll('.service')
            .data(self._saved_coords(services) ?
                services :
                self._generate_coords(services, tree))
            .enter().append('g')
            .attr('class', 'service')
            .attr('transform', function (d) {
                return 'translate(' + [d.x,d.y] + ')';
            })
            .on('click', function(d) {
                // Ignore if we clicked on a control panel image.
                if (self.hasSVGClass(d3.event.target, 'cp-button')) {
                    return;
                }

                // Get the current click action.
                var curr_click_action =
                    self.get('current_service_click_action');

                // Fire the action named in the following scheme:
                //  service_click_action.<action>
                // with the service, the SVG node, and the view
                // as arguments.
                (self.service_click_actions[curr_click_action])(d, this, self);
            })
            .on('dblclick', function(d) {
                // Just show the service on double-click.
                (self.service_click_actions.show_service)(d, this, self);
            })
            .call(drag);

        node.append('rect')
            .attr('class', 'service-border')
            .attr('width', function(d) {
                var w = service_scale_width(d.get('unit_count'));
                d.set('width', w);
                return w;
                })
            .attr('height', function(d) {
                var h = service_scale_height(d.get('unit_count'));
                d.set('height', h);
                return h;})
            .on('mouseover', function(d) {
                // Save this as the current potential drop-point for drag
                // targets if it's selectable.
                if ((d3.event.relatedTarget &&
                        d3.event.relatedTarget.nodeName == 'rect') &&
                        self.hasSVGClass(this, 'selectable-service')) {
                    console.log('mouseover', d3.event);
                    self.set('potential_drop_point_service', d);
                    self.set('potential_drop_point_rect', this);
                    self.addSVGClass(this, 'hover');
                }
            })
            .on('mouseout', function(d) {
                // Remove this node as the current potential drop-point
                // for drag targets.
                if (d3.event.relatedTarget.nodeName == 'rect' &&
                        self.hasSVGClass(this, 'hover')) {
                    self.set('potential_drop_point_service', null);
                    self.set('potential_drop_point_rect', null);
                    self.removeSVGClass(this, 'hover');
                }
            });

        var service_labels = node.append('text').append('tspan')
            .attr('class', 'name')
            .attr('x', 54)
            .attr('y', '1em')
            .text(function(d) {return d.get('id'); });

        var charm_labels = node.append('text').append('tspan')
            .attr('x', 54)
            .attr('y', '2.5em')
            .attr('dy', '3em')
            .attr('class', 'charm-label')
            .text(function(d) { return d.get('charm'); });

        // Show whether or not the service is exposed using an
        // indicator (currently a simple circle).
        // TODO this will likely change to an image with UI uodates.
        var exposed_indicator = node.filter(function(d) {
                return d.get('exposed');
            })
            .append('circle')
            .attr('cx', 0)
            .attr('cy', 10)
            .attr('r', 5)
            .attr('class', 'exposed-indicator on');
        exposed_indicator.append('title')
            .text(function(d) {
                return d.get('exposed') ? 'Exposed' : '';
            });

        // Add the relative health of a service in the form of a pie chart
        // comprised of units styled appropriately.
        // TODO aggregate statuses into good/bad/pending
        var status_chart_arc = d3.svg.arc()
            .innerRadius(10)
            .outerRadius(25);
        var status_chart_layout = d3.layout.pie()
            .value(function(d) { return (d.value ? d.value : 1); });

        var status_chart = node.append('g')
            .attr('class', 'service-status')
            .attr('transform', 'translate(30,32)');
        var status_arcs = status_chart.selectAll('path')
            .data(function(d) {
                var aggregate_map = d.get('aggregated_status'),
                    aggregate_list = [];

                for (var status_name in aggregate_map) {
                    aggregate_list.push({
                        name: status_name,
                        value: aggregate_map[status_name]
                    });
                }

                return status_chart_layout(aggregate_list);
            })
            .enter().append('path')
            .attr('d', status_chart_arc)
            .attr('class', function(d) { return 'status-' + d.data.name; })
            .attr('fill-rule', 'evenodd')
            .append('title').text(function(d) {
                return d.data.name;
            });

        // Add the unit counts, visible only on hover.
        var unit_count = status_chart.append('text')
            .attr('class', 'unit-count hide-count')
            .on('mouseover', function() {
                d3.select(this).attr('class', 'unit-count show-count');
            })
            .on('mouseout', function() {
                d3.select(this).attr('class', 'unit-count hide-count');
            })
            .text(function(d) {
                return self.humanizeNumber(d.get('unit_count'));
            });

        // Add a control panel around the service
        var control_panel = node.append('g')
            .attr('class', 'service-control-panel');

        // A button to add a relation between two services
        var add_rel = control_panel.append('g')
            .attr('class', 'add-relation')
            .on('click.cp', function(d) {
                // Get the service element
                var context = this.parentNode.parentNode;
                self.service_click_actions
                    .toggle_control_panel(d, context, self);
                self.service_click_actions
                    .add_relation_start(d, context, self);
            })

        // Drag controls on the add relation button, allowing
        // one to drag a line to create a relation
        var drag_relation = add_rel.append('line')
            .attr('class', 'relation pending-relation unused');
        var drag_relation_behavior = d3.behavior.drag()
            .on('dragstart', function(d) {
                // Get our line, the image, and the current service
                var dragline = d3.select(this.parentNode) 
                    .select('.relation');
                var img = d3.select(this.parentNode)
                    .select('image');
                var context = this.parentNode.parentNode.parentNode;

                // Start the line at our image
                dragline.attr('x1', parseInt(img.attr('x')) + 16)
                    .attr('y1', parseInt(img.attr('y')) + 16);
                self.removeSVGClass(dragline.node(), 'unused');

                // Start the add-relation process
                self.service_click_actions
                    .add_relation_start(d, context, self);
            })
            .on('drag', function() {
                // Rubberband our potential relation line
                var dragline = d3.select(this.parentNode) 
                    .select('.relation');
                dragline.attr('x2', d3.event.x)
                    .attr('y2', d3.event.y);
            })
            .on('dragend', function(d) {
                // Get the line, the endpoint service, and the target <rect>.
                var dragline = d3.select(this.parentNode) 
                    .select('.relation');
                var context = self.get('potential_drop_point_rect');
                var endpoint = self.get('potential_drop_point_service');

                // Get rid of our drag line
                dragline.attr('x2', dragline.attr('x1'))
                    .attr('y2', dragline.attr('y1'));
                self.addSVGClass(dragline.node(), 'unused');

                // If we landed on a rect, add relation, otherwise, cancel.
                if (context) {
                    self.service_click_actions
                        .add_relation_end(endpoint, context, self);
                } else {
                    // TODO clean up, abstract
                    self.add_relation(); // will clear the state
                }
            });
        add_rel.append('image')
            .attr('xlink:href', 
                '/assets/images/icons/icon_noshadow_relation.png')
            .attr('class', 'cp-button')
            .attr('x', function(d) { 
                return d.get('width') + 8;
            })
            .attr('y', function(d) {
                return (d.get('height') / 2) - 16;
            })
            .attr('width', 32)
            .attr('height', 32)
            .call(drag_relation_behavior);

        // Add a button to view the service
        var view_service = control_panel.append('g')
            .attr('class', 'view-service')
            .on('click.cp', function(d) {
                // Get the service element
                var context = this.parentNode.parentNode;
                self.service_click_actions
                    .toggle_control_panel(d, context, self);
                self.service_click_actions
                    .show_service(d, context, self);
            });
        view_service.append('image')
            .attr('xlink:href', '/assets/images/icons/icon_noshadow_view.png')
            .attr('class', 'cp-button')
            .attr('x', -40) 
            .attr('y', function(d) {
                return (d.get('height') / 2) - 16;
            })
            .attr('width', 32)
            .attr('height', 32);

        // Add a button to destroy a service
        var destroy_service = control_panel.append('g')
            .attr('class', 'destroy-service')
            .on('click.cp', function(d) {
                // Get the service element
                var context = this.parentNode.parentNode;
                self.service_click_actions
                    .toggle_control_panel(d, context, self);
                self.service_click_actions
                    .destroyServiceConfirm(d, context, self);
            });
        destroy_service.append('image')
            .attr('xlink:href', '/assets/images/icons/icon_noshadow_destroy.png')
            .attr('class', 'cp-button')
            .attr('x', function(d) { 
                return (d.get('width') / 2) - 16;
            })
            .attr('y', -40)
            .attr('width', 32)
            .attr('height', 32);
        var add_rm_units = control_panel.append('g')
            .attr('class', 'add-rm-units');


        function processRelation(r) {
            var endpoints = r.get('endpoints'),
            rel_services = [];
            Y.each(endpoints, function(ep) {
                rel_services.push(services.filter(function(d) {
                    return d.get('id') == ep[0];
                })[0]);
            });
            return rel_services;
        }

        function processRelations(rels) {
            var pairs = [];
            Y.each(rels, function(rel) {
                var pair = processRelation(rel);
                // Skip peer for now.
                if (pair.length == 2) {
                    pairs.push({source: pair[0],
                               target: pair[1]});
                }

            });
            return pairs;
        }

        self.set('tree', tree);
        self.set('vis', vis);
        update_links();
    },

    /*
     * Check to make sure that every service has saved coordinates.
     */
    _saved_coords: function(services) {
        var saved_coords = true;
        services.forEach(function(service) {
            if (!service.x || !service.y) {
                saved_coords = false;
            }
        });
        return saved_coords;
    },

    /*
     * Generates coordinates for those services that are missing them.
     */
    _generate_coords: function(services, tree) {
        services.forEach(function(service) {
            if (service.x && service.y) {
                service.set('x', service.x);
                service.set('y', service.y);
            }
        });
        var services_with_coords = tree.nodes({children: services})
            .filter(function(d) { return !d.children; });
        services_with_coords.forEach(function(service) {
            if (service.get('x') && service.get('y')) {
                service.x = service.get('x');
                service.y = service.get('y');
            }
        });
        return services_with_coords;
    },

    /*
     * Draw a relation between services.  Polylines take a list of points
     * in the form 'x y,( x y,)* x y'.
     *
     * TODO For now, just draw a straight line;
     * will eventually use A* to route around other services.
     */
    draw_relation: function(relation) {
        return (relation.source.x  + (
                    relation.source.get('width') / 2)) + ' ' +
            relation.source.y + ', ' +
            (relation.target.x + (relation.target.get('width') / 2)) + ' ' +
            relation.target.y;
    },

    /*
     * Event handler for the add relation button.
     */
    add_relation: function(evt) {
        var curr_action = this.get('current_service_click_action'),
            container = this.get('container');
        if (curr_action == 'show_service') {
            this.set('current_service_click_action', 'add_relation_start');

            // Add .selectable-service to all .service-border.
            this.addSVGClass('.service-border', 'selectable-service');
            container.one('#add-relation-btn').addClass('active');
        } else if (curr_action == 'add_relation_start' ||
                curr_action == 'add_relation_end') {
            this.set('current_service_click_action', 'toggle_control_panel');

            // Remove selectable border from all nodes.
            this.removeSVGClass('.service-border', 'selectable-service');
            container.one('#add-relation-btn').removeClass('active');
        } // Otherwise do nothing.
    },

    /*
     * Zoom in event handler.
     */
    zoom_out: function(evt) {
        this._fire_zoom(-0.2);
    },

    /*
     * Zoom out event handler.
     */
    zoom_in: function(evt) {
        this._fire_zoom(0.2);
    },

    /*
     * Wraper around the actual rescale method for zoom buttons.
     */
    _fire_zoom: function(delta) {
        var vis = this.get('vis'),
            zoom = this.get('zoom'),
            evt = {};

        // Build a temporary event that rescale can use of a similar
        // construction to d3.event.
        evt.translate = zoom.translate();
        evt.scale = zoom.scale() + delta;

        // Update the scale in our zoom behavior manager to maintain state.
        this.get('zoom').scale(evt.scale);

        this.rescale(vis, evt);
    },

    /*
     * Rescale the visualization on a zoom/pan event.
     */
    rescale: function(vis, evt) {
        this.set('scale', evt.scale);
        vis.attr('transform', 'translate(' + evt.translate + ')' +
                 ' scale(' + evt.scale + ')');
    },

    /*
     * Set the visualization size based on the viewport
     */
    setSizesFromViewport: function(vis, container, xscale, yscale) {
        // start with some reasonable defaults
        var viewport_height = '100%',
            viewport_width = parseInt(
                container.getComputedStyle('width'), 10),
            svg = container.one('svg'),
            width = 800,
            height = 600;
        if (container.get('winHeight') &&
                Y.one('#overview-tasks') &&
                Y.one('.navbar')) {
            // Attempt to get the viewport height minus the navbar at top and
            // control bar at the bottom. Use Y.one() to ensure that the
            // container is attached first (provides some sensible defaults)
            viewport_height = container.get('winHeight') -
                parseInt(Y.one('#overview-tasks')
                        .getComputedStyle('height') || 22, 10) -
                parseInt(Y.one('.navbar')
                        .getComputedStyle('height') || 70, 10) -
                parseInt(Y.one('.navbar')
                        .getComputedStyle('margin-bottom') || 18, 10);

            // Make sure we don't get sized any smaller than 800x600
            viewport_height = Math.max(viewport_height, height);
            if (container.get('winWidth') < width) {
                viewport_width = width;
            }
        }
        // Set the svg sizes
        svg.setAttribute('width', viewport_width)
            .setAttribute('height', viewport_height);

        // Get the resulting computed sizes (in the case of 100%)
        width = parseInt(svg.getComputedStyle('width'), 10);
        height = parseInt(svg.getComputedStyle('height'), 10);

        // Set the internal rect's size
        svg.one('rect').setAttribute('width', width)
            .setAttribute('height', height);

        // Reset the scale parameters
        xscale.domain([-width / 2, width / 2])
            .range([0, width]);
        yscale.domain([-height / 2, height / 2])
            .range([height, 0]);

    },

    /*
     * Actions to be called on clicking a service.
     */
    service_click_actions: {
        /*
         * Default action: show or hide control panel
         */
        toggle_control_panel: function(m, context, view) {
            var cp = Y.one(context).one('.service-control-panel');

            // If we're toggling another element, remove all .actives
            if (!view.hasSVGClass(cp, 'active')) {
                view.removeSVGClass('.service-control-panel.active', 'active');
            }

            // Toggle the current node's class
            view.toggleSVGClass(cp, 'active');
        },

        /*
         * View a service
         */
        show_service: function(m, context, view) {
            view.fire('showService', {service: m});
        },

        /*
         * Show a dialog before destroying a service
         */
        destroyServiceConfirm: function(m, context, view) {
            // set service in view
            view.set('destroy_service', m);

            // show dialog
            view.set('destroy_dialog', views.createModalPanel(
                'Are you sure you want to destroy the service? ' +
                'This cannot be undone.',
                '#destroy-modal-panel',
                'Destroy Service',
                Y.bind(function(ev) {
                        ev.preventDefault();
                        ev.target.set('disabled', true);
                        view.service_click_actions
                            .destroyService(m, context, view);
                    },
                    this)));
        },

        /*
         * Destroy a service
         */
        destroyService: function(m, context, view) {
            var env = view.get('env'),
                service = view.get('destroy_service');
            env.destroy_service(
                service.get('id'), Y.bind(function(ev) {
                    view.get('destroy_dialog').hide();
                }, this));
        },

        /*
         * Fired when clicking the first service in the add relation
         * flow.
         */
        add_relation_start: function(m, context, view) {
            // Add .selectable-service to all .service-border.
            view.addSVGClass('.service-border', 'selectable-service');

            // Remove selectable border from current node.
            var node = Y.one(context).one('.service-border');
            view.removeSVGClass(node, 'selectable-service');

            // Store start service in attrs.
            view.set('add_relation_start_service', m);

            // Set click action.
            view.set('current_service_click_action',
                    'add_relation_end');
        },

        /*
         * Fired when clicking the second service is clicked in the
         * add relation flow.
         */
        add_relation_end: function(m, context, view) {
            // Remove selectable border from all nodes
            view.removeSVGClass('.selectable-service', 'selectable-service');

            // Get the vis, tree, and links, build the new relation.
            var vis = view.get('vis'),
                tree = view.get('tree'),
                env = view.get('env'),
                container = view.get('container'),
                rel = {
                    source: view.get('add_relation_start_service'),
                    target: m
                };

            // Add temp relation between services.
            var link = vis.selectAll('path.pending-relation')
                .data([rel]);
            link.enter().insert('svg:polyline', 'g.service')
                .attr('class', 'relation pending-relation')
                .attr('points', view.draw_relation(rel));

            // Fire event to add relation in juju.
            env.add_relation(
                rel.source.get('id'),
                rel.target.get('id'),
                function(resp) {
                    container.one('#add-relation-btn').removeClass('active');
                    if (resp.err) {
                        console.log('Error adding relation');
                    }
                });
            // For now, set back to show_service.
            view.set('current_service_click_action', 'toggle_control_panel');
        }
    }

}, {
    ATTRS: {
        current_service_click_action: { value: 'toggle_control_panel' }
    }
});

views.environment = EnvironmentView;
}, '0.1.0', {
    requires: ['juju-templates',
               'juju-view-utils',
               'd3',
               'base-build',
               'handlebars-base',
               'node',
               'event-resize',
               'panel',
               'view']
});

var injections = module.exports,
    utils = require('../../utils');

var hijack = function(original, action, time_name) {
    // returns a wrapper that will replace any middleware/route function
    // following the pattern of 'function(req, x, next[, ...])'
    return function() {
        var args = Array.prototype.slice.apply(arguments),
            next = args[2],
            req = args[0],
            time = { action: action },

            times = req.EDT[time_name] = req.EDT[time_name] || [];

        times[times.length] = time;

        args[2] = function (err) {
            if (!time.time) {
                // end profiling
                var diff = process.hrtime(time.hr_start);
                time.time = {
                    seconds:      diff[0],
                    milliseconds: utils.get_ms_from_ns(diff[1])
                };
                delete time.hr_start;
            }
            next.apply(this, arguments);
        };

        // begin profiling
        time.start = Date.now();
        time.hr_start = process.hrtime();
        original.apply(this, args);
    };
};

// global request timer
injections.app_handler = function(app) {

    var handle = app.handle;

    app.handle = function (req) {
        req.EDT = { global: process.hrtime() };
        handle.apply(this, arguments);
    };
};

injections.middleware_profiler = function (app) {
    var stack = app.stack,
        original;

    for (var i = 0; i < stack.length; i++) {
        // skip middleware already covered
        if (!stack[i].handler) {

            original = stack[i].handle;
            stack[i].handler = original;

            stack[i].handle = hijack(original, stack[i], 'middleware');
            stack[i].handle.EDT_hidden = true;
        }
    }
};

injections.param_handlers = function (app) {
    var params = app._router.params,
        flat_params = [];

    Object.keys(params).forEach(function (key) {
        var key_params = utils.flatten(params[key]).map(function (item) {
            item.key = key;
            return item;
        });
        flat_params = flat_params.concat(key_params);
    });
    flat_params.forEach(function (fn) {
        var parent = fn.EDT_parent;
        // skip already hijacked params
        if (!parent[fn.EDT_index].EDT) {
            parent[fn.EDT_index].EDT_hidden = true;
            parent[fn.EDT_index] = hijack(fn, { param: fn.key, action: fn }, 'param');
            parent[fn.EDT_index].EDT = { EDT_hidden: true };
        }
    });
};

injections.route_profiler = function(app) {
    Object.keys(app.routes).forEach(function(method) {
        var routes = app.routes[method];

        routes.forEach(function(rt) {

            var current = utils.flatten(rt.callbacks);

            current.forEach(function (cb) {
                var parent = cb.EDT_parent;

                if (!parent[cb.EDT_index].EDT) {
                    parent[cb.EDT_index].EDT_hidden = true;

                    var action = { method: method, route: rt.path, handler: cb };

                    parent[cb.EDT_index] = hijack(cb, action, 'route');
                    parent[cb.EDT_index].EDT = { EDT_hidden: true };
                }
            });
        });
    })
};

injections.finalize = function(req) {
    var now = process.hrtime();
    req.EDT.global = {
        seconds:      now[0] - req.EDT.global[0],
        milliseconds: utils.get_ms_from_ns(now[1] - req.EDT.global[1])
    };

    Object.keys(req.EDT).forEach(function(type) {
        if (req.EDT[type] instanceof Array) {
            req.EDT[type].forEach(function (profile) {
                if (!profile.time) {
                    profile.time = {
                        seconds:      now[0] - profile.hr_start[0],
                        milliseconds: utils.get_ms_from_ns(now[1] - profile.hr_start[1])
                    };
                    delete profile.hr_start;
                }
            });
        }
    });
};
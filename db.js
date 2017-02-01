var couchdb = require('felix-couchdb'),
    _ = require('underscore'),
	url = require('url');

var logger = require('./lib/logger'),
    settings = {};

if (process.env.COUCH_URL) {
	var couch_url = url.parse(process.env.COUCH_URL);

    _.extend(settings, {
		port: couch_url.port,
		host: couch_url.hostname,
		db: couch_url.path
	});

	if (couch_url.auth) {
		var index = couch_url.auth.indexOf(':');

        _.extend(settings, {
            username: couch_url.auth.substring(0, index),
            password: couch_url.auth.substring(index + 1)
        });
	}
} else if (!process.env.TEST_ENV) {
    logger.error(
        'Please define a COUCH_URL in your environment e.g. \n' +
        'export COUCH_URL=\'http://admin:123qwe@localhost:5984/medic\'\n' +
        'If you are running tests use TEST_ENV=1 in your environment.\n'
    );
    process.exit(1);
}

var makeClient = function(couchdb) {
    return couchdb.createClient(
        settings.port,
        settings.host,
        settings.username,
        settings.password
    );

};

var makeDb = function(client) {
    var db = client.db(settings.db);

    // Fix for 0.4 : https://github.com/medic/medic-projects/issues/1178#issuecomment-273550990
    // Wrap the felix view calls to deal with the unexpected case where both err and result
    // are undefined. This can happen when felix can't connect to couchdb, for instance.
    // 2.x has moved off of felix (to nano), so this is an ugly patch for 0.4 only.
    var nativeViewFunc = db.view;
    db.view = function(design, view, query, cb) {
        if (typeof(query) === 'function' && !cb) {
            cb = query;
            query = undefined;
        }
        return nativeViewFunc.call(db, design, view, query, function(err, data) {
            if (!err && !data) {
                var errMessage = 'Both err and data are undefined in view call.\n' +
                    'design : ' + design + '\n' +
                    'view : ' + view + '\n' +
                    'query : ' + JSON.stringify(query, null, 2) + '\n';
                return cb(new Error(errMessage));
            }
            return cb(err, data);
        });
    };

    var nativeGetDocFunc = db.getDoc;
    db.getDoc = function(id, rev, attachments, cb) {
        if (!cb && !attachments && typeof rev === 'function') {
            cb = rev;
            rev = undefined;
        } else if (!cb && typeof attachments === 'function') {
            cb = attachments;
            if (typeof rev === 'boolean') {
                attachments = rev;
                rev = undefined;
            } else {
                attachments = undefined;
            }
        }
        return nativeGetDocFunc.call(db, id, rev, attachments, function(err, doc) {
            if (!err && !doc) {
                var errMessage = 'Both err and data are undefined in getDoc call.\n' +
                    'db : ' + JSON.stringify(db, null, 2) + '\n' +
                    'id : ' + id + '\n' +
                    'rev : ' + rev + '\n' +
                    'attachments : ' + JSON.stringify(attachments, null, 2) + '\n';
                return cb(new Error(errMessage));
            }
            return cb(err, doc);
        });
    };

    return db;
};
var client = makeClient(couchdb);
var db = makeDb(client);

module.exports = db;
module.exports.makeDbForTesting = _.compose(makeDb, makeClient);
module.exports.user = settings.username;
module.exports.fti = function(index, data, cb) {
    var path = '/_fti/local' + settings.db +
        '/_design' + settings.db + '/' + index;
    logger.debug('fti path: ', path);
    logger.debug('fti query: ', data);
    client.request({
        path: path,
        query: data
    }, cb);
};

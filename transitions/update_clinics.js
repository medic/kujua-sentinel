var _ = require('underscore'),
    logger = require('../lib/logger'),
    transitionUtils = require('./utils');

var associateContact = function(audit, doc, contact, callback) {
    var self = module.exports;

    if (!contact) {
        return callback();
    }

    // reporting phone stayed the same and contact data is up to date
    if (doc.from === contact.phone &&
        doc.contact &&
        contact._id === doc.contact._id &&
        contact._rev === doc.contact._rev) {
        return callback();
    }

    if (contact.phone !== doc.from) {
        contact.phone = doc.from;
        audit.saveDoc(contact, function(err) {
            if (err) {
                logger.error('Error updating contact: ' + JSON.stringify(err, null, 2));
                return callback(err);
            }
            self.setContact(doc, contact, callback);
        });
    } else {
        self.setContact(doc, contact, callback);
    }
};

/**
 * Update clinic data on new data records, use refid for clinic lookup otherwise
 * phone number.
 *
 * Also update phone number on clinic data when phone number is different. We
 * try to keep the phone number updated so when we setup reminders we have a
 * good place to get phone numbers from.
 */
module.exports = {
    filter: function(doc) {
        var self = module.exports;
        return Boolean(
            doc &&
            doc.type === 'data_record' &&
            !doc.contact &&
            !self._hasRun(doc)
        );
    },
    _hasRun: function(doc) {
        return Boolean(
            doc &&
            doc.transitions &&
            doc.transitions.update_clinics
        );
    },
    onMatch: function(change, db, audit, callback) {
        var doc = change.doc,
            q = { include_docs: true, limit: 1 };

        if (doc.refid) { // use reference id to find clinic if defined
            q.key = [ String(doc.refid) ];
            db.medic.view('medic', 'clinic_by_refid', q, function(err, data) {
                if (err) {
                    return callback(err);
                }
                if (!data.rows.length) {
                    // ref id not found
                    return callback();
                }
                var clinic = data.rows[0].doc;
                if (clinic.contact && clinic.contact._id) {
                    db.medic.get(clinic.contact._id, function(err, contact) {
                        if (err) {
                            return callback(err);
                        }
                        associateContact(audit, doc, contact, callback);
                    });
                } else {
                    associateContact(audit, doc, clinic.contact || { parent: clinic }, callback);
                }
            });
        } else if (doc.from) {
            q.key = [ String(doc.from) ];
            q.include_docs = true;
            db.medic.view('medic-client', 'people_by_phone', q, function(err, data) {
                if (!data.rows.length) {
                    return callback();
                }
                associateContact(audit, doc, data.rows[0].doc, callback);
            });
        } else {
            return callback();
        }
    },
    setContact: function(doc, contact, callback) {
        doc.contact = transitionUtils.extractLineage(contact);
        // remove facility not found errors
        doc.errors = _.reject(doc.errors, function(error) {
            return error.code === 'sys.facility_not_found';
        });
        callback(null, true);
    }
};

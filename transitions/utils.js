const _ = require('underscore'),
      db = require('../db'),
      ids = require('../lib/ids'),
      messages = require('../lib/messages'),
      utils = require('../lib/utils');

let idGenerator = ids.generator(db);

module.exports = {
  /*
    Adds a "message" and "error" of the configured key to the report. This
    indicates something went wrong, and the key indicates what went wrong.
  */
  addRejectionMessage: function(document, reportConfig, errorKey) {
    var foundMessage = {
      doc: document,
      message: 'messages.generic.' + errorKey,
      phone: messages.getRecipientPhone(document, 'from')
    };

    _.each(reportConfig.messages, function(msg) {
      if (msg.event_type === errorKey) {
        foundMessage = {
          doc: document,
          message: messages.getMessage(msg, utils.getLocale(document)),
          phone: messages.getRecipientPhone(document, msg.recipient)
        };
      }
    });

    // An "error" ends up being a doc.error, which is something that is shown
    // on the screen when you view the error. We need both
    messages.addError(foundMessage.doc, foundMessage.message);
    // A "message" ends up being a doc.task, which is something that is sent to
    // the caller via SMS
    return messages.addMessage(foundMessage);
  },
  addRegistrationNotFoundError: function(document, reportConfig) {
    return module.exports.addRejectionMessage(document, reportConfig, 'registration_not_found');
  },
  isIdUnique: function(db, id, callback){
    db.medic.view('medic', 'patient_by_patient_shortcode_id', {
      key: id
    }, (err, results) => {
      if (err) {
          callback(err);
      } else if (results.rows.length) {
          callback(null, false);
      } else {
          callback(null, true);
      }
    });
  },
  addUniqueId: function(db, doc, callback) {
    idGenerator.next().value.then(patientId => {
      doc.patient_id = patientId;
      callback();
    }).catch(callback);
  },
  extractLineage: function(contact) {
    if (!contact) {
      return contact;
    }
    var result = { _id: contact._id };
    var minified = result;
    while(contact.parent) {
      minified.parent = { _id: contact.parent._id };
      minified = minified.parent;
      contact = contact.parent;
    }
    return result;
  }
};

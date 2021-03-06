var _ = require('underscore'),
    async = require('async'),
    configLib = require('../config'),
    messages = require('../lib/messages'),
    moment = require('moment'),
    validation = require('../lib/validation'),
    utils = require('../lib/utils'),
    transitionUtils = require('./utils'),
    date = require('../date'),
    NAME = 'accept_patient_reports';

const _hasConfig = (doc) => {
    return Boolean(getConfig(doc.form));
};

// This is more complicated than it needs to be because JS / _ always use ===
// for equality, complicating the use of unique tuples (i.e. [1,2] !== [1,2])
const hasGroupAndType = (groupTypeColl, [group, type]) =>
    groupTypeColl.find(([g, t]) => g === group && t === type);

// This should just be
//   Object.keys(_.groupBy(tasksToClear, ({group, task}) => [group, task]))
// but JS only supports strings as keys
const uniqueGroupTypeCombos = tasks => {
    const unique = [];
    tasks.forEach(t => {
        if (!hasGroupAndType(unique, [t.group, t.type])) {
            unique.push([t.group, t.type]);
        }
    });
    return unique;
};

// find the messages to clear
const findToClear = (registration, reported_date, config) => {
    // See: https://github.com/medic/medic-docs/blob/master/user/message-states.md#message-states-in-medic-webapp
    // Both scheduled and pending have not yet been either seen by a gateway or
    // delivered, so they are both clearable.
    const typesToClear = ['pending', 'scheduled'];

    const reportedDateMoment = moment(reported_date);
    const taskTypes = config.silence_type.split(',').map(type => type.trim());

    const tasksUnderReview = utils.getScheduledTasksByType(registration, taskTypes);

    if (!config.silence_for) {
        // No range, all clearable tasks should be cleared
        return tasksUnderReview.filter(task => typesToClear.includes(task.state));
    } else {
        // Clear all tasks that are members of a group that "exists" before the
        // silenceUntil date. e.g., they have at least one task in their group
        // whose due date is before silenceUntil.
        const silenceUntil = reportedDateMoment.clone();
        silenceUntil.add(date.getDuration(config.silence_for));

        const allTasksBeforeSilenceUntil = tasksUnderReview.filter(task =>
            moment(task.due) <= silenceUntil);
        const groupTypeCombosToClear = uniqueGroupTypeCombos(allTasksBeforeSilenceUntil);

        return tasksUnderReview.filter(({group, type}) =>
            hasGroupAndType(groupTypeCombosToClear, [group, type]));
    }
};

const getConfig = function(form) {
    const fullConfig = configLib.get('patient_reports') || [];
    return _.findWhere(fullConfig, { form: form });
};

const _silenceReminders = (audit, registration, reported_date, config, callback) => {
    var toClear = module.exports._findToClear(registration, reported_date, config);
    if (!toClear.length) {
        return callback();
    }

    toClear.forEach(task => utils.setTaskState(task, 'cleared'));
    audit.saveDoc(registration, callback);
};

const silenceRegistrations = (
            audit,
            config,
            doc,
            registrations,
            callback) => {
    if (!config.silence_type) {
        return callback(null, true);
    }
    async.forEach(
        registrations,
        function(registration, callback) {
            if (doc._id === registration.id) {
                // don't silence the registration you're processing
                return callback();
            }
            module.exports._silenceReminders(
                audit, registration, doc.reported_date, config, callback);
        },
        function(err) {
            callback(err, true);
        }
    );
};

const validate = (config, doc, callback) => {
    var validations = config.validations && config.validations.list;
    return validation.validate(doc, validations, callback);
};

const addErrorsToDoc = (errors, doc, config) => {
    messages.addErrors(doc, errors);
    if (config.validations.join_responses) {
        var msgs = [];
        errors.forEach(err => {
            if (err.message) {
                msgs.push(err.message);
            } else if (err) {
                msgs.push(err);
            }
        });
        messages.addReply(doc, msgs.join('  '));
    } else {
        messages.addReply(doc, errors[0].message || errors[0]);
    }
};

const addMessagesToDoc = (doc, config, registrations, patientContact) => {
    const locale = utils.getLocale(doc);
    config.messages.forEach(msg => {
        if (msg.event_type === 'report_accepted') {
            messages.addMessage({
                doc: doc,
                message: messages.getMessage(msg, locale),
                phone: messages.getRecipientPhone(doc, msg.recipient),
                patient: patientContact,
                registrations: registrations
            });
        }
    });
};

module.exports = {
    filter: function(doc) {
        return Boolean(
            doc &&
            doc.type === 'data_record' &&
            doc.form &&
            doc.reported_date &&
            !transitionUtils.hasRun(doc, NAME) &&
            _hasConfig(doc) &&
            utils.getClinicPhone(doc)
        );
    },
    _silenceReminders: _silenceReminders,
    _findToClear: findToClear,
    // also used by registrations transition.
    handleReport: function(
            db,
            audit,
            doc,
            patientContact,
            config,
            callback) {
        utils.getRegistrations({
            db: db,
            id: doc.fields && doc.fields.patient_id
        },
        function(err, registrations) {
            if (err) {
                return callback(err);
            }

            if (patientContact) {
                addMessagesToDoc(doc, config, registrations, patientContact);
            }

            if (registrations && registrations.length) {
                return silenceRegistrations(
                    audit,
                    config,
                    doc,
                    registrations,
                    callback);
            }

            return callback(null, true);
        });
    },
    onMatch: function(change, _db, _audit, callback) {
        const doc = change.doc;

        const config = getConfig(doc.form);

        if (!config) {
            return callback();
        }

        validate(config, doc, function(errors) {
            if (errors && errors.length > 0) {
                addErrorsToDoc(errors, doc, config);
                return callback(null, true);
            }

            utils.getPatientContact(_db, doc.fields.patient_id, function(err, patientContact) {
                if (err) {
                    return callback(err);
                }
                if (!patientContact) {
                    transitionUtils.addRegistrationNotFoundError(doc, config);
                    return callback(null, true);
                }
                module.exports.handleReport(
                    _db,
                    _audit,
                    doc,
                    patientContact,
                    config,
                    callback);
            });
        });
    }
};

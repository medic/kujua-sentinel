var _ = require('underscore'),
    transition = require('../../transitions/registration'),
    sinon = require('sinon'),
    moment = require('moment'),
    utils = require('../../lib/utils'),
    related_entities,
    config;

related_entities = {
    clinic: {
        contact: {
            phone: '+1234'
        }
    }
};

function getMessage(doc) {
    if (!doc || !doc.tasks) return;
    return _.first(_.first(doc.tasks).messages).message;
}

exports.setUp = function(callback) {
    sinon.stub(transition, 'getConfig').returns([{
        form: 'BIR',
        events: [
           {
               "name": "on_create",
               "trigger": "add_patient_id",
               "params": "",
               "bool_expr": ""
           },
           {
               "name": "on_create",
               "trigger": "add_birth_date",
               "params": "",
               "bool_expr": ""
           }
        ],
        validations: [
            {
                property: 'weeks_since_birth',
                rule: 'min(0) && max(52)',
                message: [{
                    content: 'Invalid DOB; must be between 0-52 weeks.',
                    locale: 'en'
                }]
            },
            {
                property: 'patient_name',
                rule: 'lenMin(1) && lenMax(100)',
                message: [{
                    content: 'Invalid patient name.',
                    locale: 'en'
                }]
            }
        ]
    }]);
    callback();
};

exports.tearDown = function(callback) {
    if (utils.getRegistrations.restore)
        utils.getRegistrations.restore();

    if (transition.getConfig.restore)
        transition.getConfig.restore();

    callback();
}

exports['setBirthDate sets birth_date correctly for weeks_since_birth: 0'] = function(test) {
    var doc,
        start = moment().startOf('week');
    doc = {
        weeks_since_birth: 0
    };
    transition.setBirthDate(doc);
    test.ok(doc.birth_date);
    test.equals(doc.birth_date, start.clone().add(0, 'weeks').toISOString());
    test.done();
};

exports['setBirthDate sets birth_date correctly for age_in_weeks 10'] = function(test) {
    var doc,
        start = moment().startOf('week');
    doc = {
        age_in_weeks: 10
    };
    transition.setBirthDate(doc);
    test.ok(doc.birth_date);
    test.equals(doc.birth_date, start.clone().subtract(10, 'weeks').toISOString());
    test.done();
};

exports['setBirthDate sets birth_date correctly for days_since_birth: 0'] = function(test) {
    var doc = { days_since_birth: 0 },
        expected = moment().startOf('day').toISOString();
    transition.setBirthDate(doc);
    test.ok(doc.birth_date);
    test.equals(doc.birth_date, expected);
    test.done();
};

exports['setBirthDate sets birth_date correctly for age_in_days: 10'] = function(test) {
    var doc = { age_in_days: 10 },
        expected = moment().startOf('day').subtract(10, 'days').toISOString();
    transition.setBirthDate(doc);
    test.ok(doc.birth_date);
    test.equals(doc.birth_date, expected);
    test.done();
};

exports['valid form adds patient_id and expected_date'] = function(test) {

    sinon.stub(utils, 'getRegistrations').callsArgWithAsync(1, null, []);

    var doc = {
        form: 'BIR',
        patient_name: 'abc',
        weeks_since_birth: 1
    };

    transition.onMatch({
        doc: doc
    }, {}, {}, function(err, complete) {
        test.equals(err, null);
        test.equals(complete, true);
        test.ok(doc.patient_id);
        test.ok(doc.birth_date);
        test.equals(doc.tasks, undefined);
        test.done();
    });
};

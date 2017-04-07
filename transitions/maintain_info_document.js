const infoDocId = id => id + '-info';

const getSisterInfoDoc = (db, docId, callback) =>
  db.medic.get(infoDocId(docId), (err, body) => {
    if (err && err.statusCode !== 404) {
      callback(err);
    } else {
      callback(null, body);
    }
  });

const createInfoDoc = (docId, initialReplicationDate) => {
  return  {
    _id: infoDocId(docId),
    type: 'info',
    doc_id: docId,
    initial_replication_date: initialReplicationDate
  };
};

const generateInfoDocFromAuditTrail = (audit, docId, callback) =>
  audit.get(docId, (err, auditDoc) => {
    if (err && err.statusCode !== 404) {
      callback(err);
    } else {
      const create = auditDoc &&
                     auditDoc.history &&
                     auditDoc.history.find(el => el.action === 'create');

      if (create) {
        callback(null, createInfoDoc(docId, create.timestamp));
      } else {
        callback();
      }
    }
  });

module.exports = {
  filter: doc => !(doc._id.startsWith('_design') ||
                   doc.type === 'info'),
  onMatch: (change, db, audit, callback) =>
    getSisterInfoDoc(db, change.id, (err, infoDoc) => {
      if (err) {
        return callback(err);
      }

      if (infoDoc) {
        infoDoc.latest_replication_date = new Date();
        return db.medic.insert(infoDoc, callback);
      }

      generateInfoDocFromAuditTrail(audit, change.id, (err, infoDoc) => {
        if (err) {
          return callback(err);
        }

        infoDoc = infoDoc || createInfoDoc(change.id, 'unknown');

        infoDoc.latest_replication_date = new Date();
        return db.medic.insert(infoDoc, callback);
      });
    })
};

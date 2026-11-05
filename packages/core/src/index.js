'use strict';

module.exports = {
  ports: require('./ports'),
  shareScope: require('./lib/share-scope'),
  projectPassword: require('./lib/project-password'),
  analytics: require('./lib/analytics'),
  revision: require('./lib/revision'),
  export: require('./lib/export'),
  heatmap: require('./lib/heatmap'),
  upload: require('./lib/upload'),
  notes: require('./lib/notes'),
  adminApi: {
    service: require('./admin-api/service'),
    beacon: require('./admin-api/beacon'),
    lead: require('./admin-api/lead'),
    analytics: require('./admin-api/analytics')
  },
  viewer: {
    access: require('./viewer/access'),
    service: require('./viewer/service'),
    home: require('./viewer/home')
  }
};

import Ember from 'ember';
import Onepanel from 'npm:onepanel';

const {
  assert,
  inject: {
    service
  },
  RSVP: {
    Promise
  }
} = Ember;

const {
  ProviderConfiguration,
  TaskStatus: {
    StatusEnum
  }
} = Onepanel;

let ObjectPromiseProxy = Ember.ObjectProxy.extend(Ember.PromiseProxyMixin);

function getClusterHostname(hostnames) {
  return hostnames.objectAt(0);
}

function getDomain(hostname) {
  return hostname.split('.').splice(1).join('.');
}

function getHostname(hostname) {
  return hostname.split('.')[0];
}

function getHostnamesOfType(hosts, type) {
  return hosts.filter(h => h[type]).map(h => h.hostname);
}

function getTaskId(location) {
  return location.match(/^.*\/(.*)$/)[1];
}

export default Ember.Component.extend({
  onepanelServer: service(),
  clusterManager: service(),

  primaryClusterManager: null,

  /**
   * @type {ObjectPromiseProxy<Ember.A<HostInfo>>}
   */
  hosts: null,

  init() {
    this._super(...arguments);
    this.set(
      'hosts',
      ObjectPromiseProxy.create({
        promise: this.get('clusterManager').getHosts()
      })
    );
  },

  /**
   * Periodically checks the status of task.
   *
   * Invokes passed callbacks on status events.
   *
   * @param {string} taskId
   * @return {jQuery.Promise}
   */
  watchTaskStatus(taskId) {
    let deferred = $.Deferred();

    // TODO: should we stop on getStatusError? - maybe failure counter
    let selfArguments = arguments;
    let onepanelServer = this.get('onepanelServer');
    let gettingTaskStatus = onepanelServer.request('onepanel', 'getTaskStatus', taskId);
    let deferSelf = (timeout) => {
      setTimeout(() => this.watchTaskStatus(...selfArguments), timeout);
    };

    gettingTaskStatus.then(({
      data: taskStatus
    }) => {
      switch (taskStatus.status) {
        case StatusEnum.ok:
        case StatusEnum.error:
          deferred.resolve(taskStatus);
          break;
        case StatusEnum.running:
          deferred.notify(taskStatus);
          deferSelf(1000);
          break;
        default:
          console.warn('watchTaskStatus: invalid taskStatus: ' + JSON.serialize('taskStatus'));
          deferSelf(1000);
          break;
      }
    });

    gettingTaskStatus.catch(error => {
      console.error('component:new-cluster-installation: getting status of configure task failed');
      deferred.reject(error);
    });

    return deferred.promise();
  },

  /**
   * @return {jQuery.Promise}  promise resolves if configuration completes (either success or fail);
   *                    rejects when getting status failed
   */
  configureProviderStarted(data, response) {
    assert(
      'configure provider response should have location header',
      response && response.headers && response.headers.location
    );
    let taskId = getTaskId(response.headers.location);
    return this.watchTaskStatus(taskId);
  },

  configureProviderFinished() {
    let id = 'only_cluster';

    let creatingCluster = this.get('clusterManager').createCluster({
      id,
      label: 'Cluster'
    });

    creatingCluster.then(cluster => {
      this.sendAction('clusterCreated', cluster);
      this.sendAction('nextStep');
    });
  },

  configureProviderFailed({
    error,
    taskStatus
  }) {
    if (error) {
      console.error(`Configure provider failed (${error.response.statusCode}): ${error.response.text}`);
    } else if (taskStatus) {
      console.error(`Configure provider failed: ${JSON.stringify(taskStatus)}`);
    }
  },

  getNodes() {
    let hosts = this.get('hosts');
    hosts = hosts.content;
    let hostnames = hosts.map(h => h.hostname);
    let nodes = {};
    hostnames.forEach(hn => {
      nodes[hn] = {
        hostname: getHostname(hn)
      };
    });
    return nodes;
  },

  /**
   * @return {Onepanel.ProviderConfiguration}
   */
  createProviderConfiguration() {
    let {
      hosts,
      primaryClusterManager
    } = this.getProperties(
      'hosts',
      'primaryClusterManager'
    );

    hosts = hosts.content;

    let nodes = this.getNodes();
    let hostnames = hosts.map(h => h.hostname);
    let domainName = getDomain(getClusterHostname(hostnames));

    let providerConfiguration = ProviderConfiguration.constructFromObject({
      cluster: {
        domainName,
        autoDeploy: true,
        nodes,
        managers: {
          mainNode: primaryClusterManager,
          nodes: getHostnamesOfType(hosts, 'clusterManager'),
        },
        workers: {
          nodes: getHostnamesOfType(hosts, 'clusterWorker'),
        },
        databases: {
          nodes: getHostnamesOfType(hosts, 'database')
        }
      }
    });

    return providerConfiguration;
  },

  /**
   * Makes a backend call to start cluster deployment and watches deployment process.
   * Returned promise resolves when deployment started (NOTE: not when it finishes).
   * The promise resolves with a Promise of deployment progress
   * (see: ``this.configureProviderStarted``).
   * @return {Promise}
   */
  startDeploy() {
    return new Promise((resolve, reject) => {
      // TODO use oneprovider or onezone api
      let onepanelServer = this.get('onepanelServer');
      let providerConfiguration = this.createProviderConfiguration();
      let startConfiguringProvider =
        onepanelServer.request('oneprovider', 'configureProvider', providerConfiguration);

      startConfiguringProvider.then(({
        data,
        response
      }) => {
        let configuring = this.configureProviderStarted(data, response);

        resolve({
          data,
          response,
          deployment: configuring
        });
      });

      startConfiguringProvider.catch(reject);
    });
  },

  /**
   * Show progress of deployment using deployment task promise.
   * @param {jQuery.Promise} deployment 
   */
  showDeployProgress(deployment) {
    this.set('deploymentPromise', deployment);
  },

  hideDeployProgress() {
    this.set('deploymentPromise', null);
  },

  actions: {
    checkboxChanged(checked, event) {
      let hosts = this.get('hosts.content');
      let checkbox = event.currentTarget;
      let hostname = checkbox.getAttribute('data-hostname');
      let option = checkbox.getAttribute('data-option');
      let host = hosts.find(h => h.hostname === hostname);
      assert(
        host,
        'host for which option was changed, must be present in collection'
      );
      host[option] = checked;

      // TODO debug
      console.debug(JSON.stringify(hosts));
    },

    primaryClusterManagerChanged(hostname) {
      this.set('primaryClusterManager', hostname);
    },

    /**
     * Start deployment process.
     *
     * When process starts successfully, a deployment promise
     * is bound to success/failure handlers and a deploy process is shown.
     * 
     * Returned promise resolves when backend started deployment.
     * 
     * @return {Promise}
     */
    startDeploy() {
      // TODO do not allow if not valid data
      let startingDeploy = this.startDeploy();
      startingDeploy.then(({
        data,
        deployment
      }) => {
        this.showDeployProgress(deployment);

        deployment.done(taskStatus => {
          if (taskStatus.status === StatusEnum.ok) {
            this.configureProviderFinished(taskStatus);
          } else {
            this.configureProviderFailed({
              taskStatus
            });
          }

        });

        deployment.fail(error => this.configureProviderFailed({
          error
        }));

        deployment.always(() => this.hideDeployProgress());
      });

      return startingDeploy;
    }
  }
});

import Ember from 'ember';

const {
  inject: {
    service
  },
  computed,
  RSVP: {
    Promise
  },
  String: {
    htmlSafe
  }
} = Ember;

const ObjectPromiseProxy = Ember.ObjectProxy.extend(Ember.PromiseProxyMixin);

export default Ember.Component.extend({
  classNames: ['app-layout'],

  mainMenu: service(),
  sidebarResources: service(),
  eventsBus: service(),
  sideMenu: service(),

  // TODO: too much relations: we got mainMenuItemChanged event
  currentTabId: computed.readOnly('mainMenu.currentItemId'),
  sidenavTabId: null,
  showMobileSidebar: true,

  sidenavContentComponent: computed('sidenavTabId', function() {
    let sidenavTabId = this.get('sidenavTabId');
    return `sidebar-${sidenavTabId}`;
  }),

  sidenavModel: computed('sidenavTabId', function() {
    let {
      sidenavTabId,
      sidebarResources
    } = this.getProperties('sidenavTabId', 'sidebarResources');
    
    let resourceType = sidenavTabId;

    let gettingModel = sidebarResources.getModelFor(resourceType);
    let promise = new Promise((resolve, reject) => {
      gettingModel.then(collection => {
        resolve({
          resourceType,
          collection
        });
      });
      gettingModel.catch(reject);
    });

    return ObjectPromiseProxy.create({ promise });
  }),

  colSidebarClass: computed('showMobileSidebar', function() {
    let showMobileSidebar = this.get('showMobileSidebar');
    let base = 'col-in-app-layout col-sidebar col-sm-4 col-md-3 col-lg-2 full-height disable-user-select';
    let xsClass = (showMobileSidebar ? 'col-xs-12' : 'hidden-xs');
    return htmlSafe(`${base} ${xsClass}`);
  }),

  colContentClass: computed('showMobileSidebar', function() {
    let showMobileSidebar = this.get('showMobileSidebar');
    let base = 'col-in-app-layout col-content col-sm-8 col-md-7 col-lg-9 full-height';
    let xsClass = (showMobileSidebar ? 'hidden-xs' : 'col-xs-12');
    return htmlSafe(`${base} ${xsClass}`);
  }),

  init() {
    this._super(...arguments);
    this.get('eventsBus').on('one-sidenav:open', (selector) => {
      if (selector === '#sidenav-sidebar') {
        this.set('sidenavSidebarOpen', true);
      }
    });
    this.get('eventsBus').on('one-sidenav:close', (selector) => {
      if (selector === '#sidenav-sidebar') {
        this.set('sidenavSidebarOpen', false);
        this.set('sidenavTabId', null);
      }
    });
  },

  actions: {
    // TODO IMPORTANT: who is receiver of eventsBus' one-sidenav:open/close?
    closeSidenav() {
      this.get('eventsBus').trigger('one-sidenav:close', '#sidenav-sidebar');
    },
    // TODO IMPORTANT: inconsistent depedencies between component:main-menu, service:main-menu and component:app-layout
    mainMenuItemClicked(itemId) {
      let shouldOpen = (this.get('sidenavTabId') !== itemId);
      let action = (shouldOpen ? 'open' : 'close');
      this.get('eventsBus').trigger('one-sidenav:' + action, '#sidenav-sidebar');
      if (shouldOpen) {
        this.set('sidenavTabId', itemId);
      }
    },
    mobileMenuItemChanged() {
      let sideMenu = this.get('sideMenu');
      sideMenu.close();
      this.set('sidenavTabId', null);
    },
    showMobileSidebar() {
      this.set('showMobileSidebar', true);
    }
  }
});
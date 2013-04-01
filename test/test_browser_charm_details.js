'use strict';

(function() {

  describe('browser_charm_view', function() {
    var CharmView, models, node, view, views, Y;

    before(function(done) {
      Y = YUI(GlobalConfig).use(
          'node-event-simulate',
          'juju-charm-models',
          'juju-charm-store',
          'node',
          'subapp-browser-charmview',
          function(Y) {
            views = Y.namespace('juju.browser.views');
            models = Y.namespace('juju.models');
            CharmView = views.BrowserCharmView;
            done();
          });
    });

    beforeEach(function() {
      var docBody = Y.one(document.body);
      Y.Node.create('<div id="testcontent">' +
          '</div>').appendTo(docBody);

      // Mock out a dummy location for the Store used in view instances.
      window.juju_config = {
        charmworldURL: 'http://localhost'
      };
      node = Y.one('#testcontent');
    });

    afterEach(function() {
      view.destroy();
      node.remove(true);
      delete window.juju_config;
    });

    // Ensure the search results are rendered inside the container.
    it('should be able to locate a readme file', function() {
      view = new CharmView({
        charm: new models.BrowserCharm({
          files: [
            'hooks/install',
            'readme.rst'
          ],
          id: 'precise/ceph-9'
        })
      });
      view._locateReadme().should.eql('readme.rst');

      // Matches for caps as well
      view.get('charm').set('files', [
        'hooks/install',
        'README.md'
      ]);
      view._locateReadme().should.eql('README.md');
    });


    it('should be able to display the readme content', function() {
      var fakeStore = new Y.juju.Charmworld0({});
      fakeStore.set('datasource', {
        sendRequest: function(params) {
          // Stubbing the server callback value
          params.callback.success({
            response: {
              results: [{
                responseText: 'README content.'
              }]
            }
          });
        }
      });

      view = new CharmView({
        charm: new models.BrowserCharm({
          files: [
            'hooks/install',
            'readme.rst'
          ],
          id: 'precise/ceph-9'
        }),
        store: fakeStore
      });

      view.render(node);
      Y.one('#bws_readme').get('text').should.eql('README content.');
    });

    // EVENTS
    it('should catch when the add control is clicked', function(done) {
      view = new CharmView({
        charm: new models.BrowserCharm({
          files: [
            'hooks/install'
          ],
          id: 'precise/ceph-9'
        })
      });

      // Hook up to the callback for the click event.
      view._addCharmEnvironment = function(ev) {
        ev.preventDefault();
        Y.one('#bws_readme h3').get('text').should.eql('Charm has no README');
        done();
      };

      view.render(node);
      view.get('container').should.eql(node);
      node.one('.charm input.add').simulate('click');
    });

    it('should catch when the open log is clicked', function(done) {
      view = new CharmView({
        charm: new models.BrowserCharm({
          files: [
            'hooks/install'
          ],
          id: 'precise/ceph-9'
        })
      });

      // Hook up to the callback for the click event.
      view._toggleLog = function(ev) {
        ev.preventDefault();
        Y.one('#bws_readme h3').get('text').should.eql('Charm has no README');
        done();
      };

      view.render(node);
      view.get('container').should.eql(node);
      node.one('.changelog .toggle').simulate('click');
    });

    it('should load a file when the hook filename is clicked', function() {
      var fakeStore = new Y.juju.Charmworld0({});
      fakeStore.set('datasource', {
        sendRequest: function(params) {
          // Stubbing the server callback value
          params.callback.success({
            response: {
              results: [{
                responseText: 'install hook content.'
              }]
            }
          });
        }
      });

      view = new CharmView({
        charm: new models.BrowserCharm({
          files: [
            'hooks/install',
            'readme.rst'
          ],
          id: 'precise/ceph-9'
        }),
        store: fakeStore
      });

      view.render(node);
      Y.one('#bws_hooks').all('ul li a').size().should.eql(2);

      // Click on the hooks install and the content should update.
      Y.one('#bws_hooks').one('ul li a').simulate('click');

      var content = Y.one('#bws_hooks').one('div.filecontent');
      content.get('text').should.eql('install hook content.');
    });

    it('should be able to render markdown as html', function() {
      var fakeStore = new Y.juju.Charmworld0({});
      fakeStore.set('datasource', {
        sendRequest: function(params) {
          // Stubbing the server callback value
          params.callback.success({
            response: {
              results: [{
                responseText: [
                  'README Header',
                  '============='
                ].join('\n')
              }]
            }
          });
        }
      });

      view = new CharmView({
        charm: new models.BrowserCharm({
          files: [
            'readme.md'
          ],
          id: 'precise/ceph-9'
        }),
        store: fakeStore
      });

      view.render(node);
      Y.one('#bws_readme').get('innerHTML').should.eql(
          '<h1>README Header</h1>');
    });
  });
})();

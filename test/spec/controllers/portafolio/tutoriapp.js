'use strict';

describe('Controller: PortafolioTutoriappCtrl', function () {

  // load the controller's module
  beforeEach(module('cooldevcoApp'));

  var PortafolioTutoriappCtrl,
    scope;

  // Initialize the controller and a mock scope
  beforeEach(inject(function ($controller, $rootScope) {
    scope = $rootScope.$new();
    PortafolioTutoriappCtrl = $controller('PortafolioTutoriappCtrl', {
      $scope: scope
    });
  }));

  it('should attach a list of awesomeThings to the scope', function () {
    expect(scope.awesomeThings.length).toBe(3);
  });
});

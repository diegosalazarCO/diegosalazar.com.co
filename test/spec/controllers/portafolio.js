'use strict';

describe('Controller: PortafolioCtrl', function () {

  // load the controller's module
  beforeEach(module('cooldevcoApp'));

  var PortafolioCtrl,
    scope;

  // Initialize the controller and a mock scope
  beforeEach(inject(function ($controller, $rootScope) {
    scope = $rootScope.$new();
    PortafolioCtrl = $controller('PortafolioCtrl', {
      $scope: scope
    });
  }));

  it('should attach a list of awesomeThings to the scope', function () {
    expect(scope.awesomeThings.length).toBe(3);
  });
});

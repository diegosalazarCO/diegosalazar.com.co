'use strict';

describe('Directive: typer', function () {

  // load the directive's module
  beforeEach(module('cooldevcoApp'));

  var element,
    scope;

  beforeEach(inject(function ($rootScope) {
    scope = $rootScope.$new();
  }));

  it('should make hidden element visible', inject(function ($compile) {
    element = angular.element('<typer></typer>');
    element = $compile(element)(scope);
    expect(element.text()).toBe('this is the typer directive');
  }));
});

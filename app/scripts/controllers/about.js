'use strict';

/**
 * @ngdoc function
 * @name cooldevcoApp.controller:AboutCtrl
 * @description
 * # AboutCtrl
 * Controller of the cooldevcoApp
 */
angular.module('cooldevcoApp')
  .controller('AboutCtrl', function ($scope) {
    $scope.awesomeThings = [
      'HTML5 Boilerplate',
      'AngularJS',
      'Karma'
    ];
  });

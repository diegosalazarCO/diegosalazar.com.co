'use strict';

/**
 * @ngdoc overview
 * @name cooldevcoApp
 * @description
 * # cooldevcoApp
 *
 * Main module of the application.
 */
angular
  .module('cooldevcoApp', [
    'ngAnimate',
    'ngAria',
    'ngCookies',
    'ngMessages',
    'ngResource',
    'ngRoute',
    'ngSanitize',
    'ngTouch'
  ])
  .config(function ($routeProvider) {
    $routeProvider
      .when('/', {
        templateUrl: 'views/main.html',
        controller: 'MainCtrl'
      })
      .when('/about', {
        templateUrl: 'views/about.html',
        controller: 'AboutCtrl'
      })
      .when('/portafolio', {
        templateUrl: 'views/portafolio.html',
        controller: 'PortafolioCtrl'
      })
      .when('/contacto', {
        templateUrl: 'views/contacto.html',
        controller: 'ContactoCtrl'
      })
      .when('/portafolio/tutoriapp', {
        templateUrl: 'views/portafolio/tutoriapp.html',
        controller: 'PortafolioTutoriappCtrl'
      })
      .otherwise({
        redirectTo: '/'
      });
  });


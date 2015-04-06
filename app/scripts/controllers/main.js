'use strict';

/**
 * @ngdoc function
 * @name cooldevcoApp.controller:MainCtrl
 * @description
 * # MainCtrl
 * Controller of the cooldevcoApp
 */
angular.module('cooldevcoApp')
  .controller('MainCtrl', function ($scope) {
    $scope.awesomeThings = [
      'Desarrollo iOS apps',
      'Desarrollo web apps',
      'Desarrollo websites',
      'Desarrollo Backend',
      'Desarrollo Frontend'
    ];

  })

  .directive('drawing', function (){
  	return {
  		restrict: 'A',
    link: function(scope, element){
      
    	var w = window.innerWidth            || 
		document.documentElement.clientWidth || 
		document.body.clientWidth;

		var h = window.innerHeight            || 
		document.documentElement.clientHeight || 
		document.body.clientHeight;

		var canvas = document.querySelector('canvas'),
		ctx = element[0].getContext('2d'),
		//ctx = document.getCSSCanvasContext('2d', 'animation', w, h),
		particles = [],
		patriclesNum = 20,
		colors = ['#fff','#fff','#fff','#fff','#fff'];

		canvas.width = w;
		canvas.height = h;
		canvas.style.left = (window.innerWidth - 500)/2+'px';

		if(window.innerHeight>500){
  			canvas.style.top = (window.innerHeight - 500)/2+'px';
		}

		function Factory(){  
		  this.x =  Math.round( Math.random() * w);
		  this.y =  Math.round( Math.random() * h);
		  this.rad = Math.round( Math.random() * 1) + 1;
		  //this.rgba = colors[ Math.round( Math.random() * 3) ];
		  this.rgba = '#E7E7E7';
		  this.vx = Math.round( Math.random() * 1) - 0.7;
		  this.vy = Math.round( Math.random() * 1) - 0.7;
		}
   
		function draw(){

		  // w = window.innerWidth || 
		  // document.documentElement.clientWidth || 
		  // document.body.clientWidth;

		  // h = window.innerHeight || 
		  // document.documentElement.clientHeight || 
		  // document.body.clientHeight;

		  ctx.clearRect(0, 0, w, h);
		  //ctx.globalCompositeOperation = 'lighter';
		  for(var i = 0;i < patriclesNum; i++){
		    var temp = particles[i];
		    var factor = 1;
		     
		    for(var j = 0; j<patriclesNum; j++){
		      
		       var temp2 = particles[j];
		       ctx.linewidth = 1;
		      
		       if(temp.rgba === temp2.rgba && findDistance(temp, temp2)<80){
		          ctx.strokeStyle = temp.rgba;
		          ctx.beginPath();
		          ctx.moveTo(temp.x, temp.y);
		          ctx.lineTo(temp2.x, temp2.y);
		          ctx.stroke();
		          factor++;
		       }
		    }
		    
		    
		    ctx.fillStyle = temp.rgba;
		    ctx.strokeStyle = temp.rgba;
		    
		    ctx.beginPath();
		    ctx.arc(temp.x, temp.y, temp.rad*factor, 0, Math.PI*2, true);
		    ctx.fill();
		    ctx.closePath();
		    
		    ctx.beginPath();
		    ctx.arc(temp.x, temp.y, (temp.rad+5)*factor, 0, Math.PI*2, true);
		    ctx.lineWidth = 1;
		    ctx.stroke();
		    ctx.closePath();
		    
		    temp.x += temp.vx;
		    temp.y += temp.vy;
		    
		    if(temp.x > w){temp.x = 0;}
		    if(temp.x < 0){temp.x = w;}
		    if(temp.y > h){temp.y = 0;}
		    if(temp.y < 0){temp.y = h;}
		  }
		}

		function findDistance(p1,p2){  
		  return Math.sqrt( Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2) );
		}

		window.requestAnimFrame = (function(){
		  return  window.requestAnimationFrame       ||
		          window.webkitRequestAnimationFrame ||
		          window.mozRequestAnimationFrame    ||
		          function( callback ){
		            window.setTimeout(callback, 1000 / 60);
		          };
		})();

		(function init(){
		  for(var i = 0; i < patriclesNum; i++){
		    particles.push(new Factory);
		  }
		})();

		(function loop(){
		  draw();
		  requestAnimFrame(loop);
		})();

    }

  	};
  });


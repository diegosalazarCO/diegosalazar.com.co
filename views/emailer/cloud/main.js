
// Use Parse.Cloud.define to define as many cloud functions as you want.
// For example:
//Parse.Cloud.define("hello", function(request, response) {
//  response.success("Hello world!");
//});
Parse.Cloud.define("sendEmail", function(request, response) {
  var sendgrid = require("sendgrid");
  sendgrid.initialize("diegosalazarco", "NS0bj3ctKir@");
 
  var name = request.params.name;
  var email = request.params.email;
  var message = request.params.message;
 
  sendgrid.sendEmail({
   to: "hola@diegosalazar.com.co",
   from: email,
   fromname: name,
   subject: "Contacto: Email de " + name,
   text: "Name: "+name+"\nEmail: "+email+"\nMessage:\n\n"+message
   }, {
     success: function(httpResponse) {
       console.log(httpResponse);
       response.success("Email sent!");
    },
     error: function(httpResponse) {
       console.error(httpResponse);
       response.error("Uh oh, something went wrong");
    }
  });
});

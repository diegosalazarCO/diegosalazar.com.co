$(document).ready(function(){
 
  // Initialize Parse with your Parse application & javascript keys
  Parse.initialize("3dvD5vdf1Eij51pH0XOdbzPjOUTY1MOV5oKia1lH", "CQSRjLnXTmIEKFV6JtyXxf3y0azb7nu7Ltybq33Y");
 
  // Setup the form to watch for the submit event
  $('#myForm').submit(function(e){
    e.preventDefault();
 
    // Grab the elements from the form to make up
    // an object containing name, email and message
    var data = { 
      name: document.getElementById('name').value, 
      email: document.getElementById('email').value,
      message: document.getElementById('message').value
    }
    
    // Run our Parse Cloud Code and 
    // pass our 'data' object to it
    Parse.Cloud.run("sendEmail", data, {
      success: function(object) {
        $('success').removeClass('hidden').fadeIn('fast');
      },
 
      error: function(object, error) {
        console.log(error);
        $('error').removeClass('hidden').fadeIn('fast');
      }
    });
  });
 
});
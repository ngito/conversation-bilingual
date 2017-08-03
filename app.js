/**
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

require( 'dotenv' ).config( {silent: true} );

/* Google Translate API - Start */
var translateApiKey = process.env.TRANSLATE_API_KEY
var googleTranslate = require('google-translate')(translateApiKey);
var languageFrom = process.env.LANGUAGE_FROM
var languageTo   = process.env.LANGUAGE_TO
/* Google Translate API - Ends */

var express = require( 'express' );  // app server
var bodyParser = require( 'body-parser' );  // parser for post requests
var Watson = require( 'watson-developer-cloud/conversation/v1' );  // watson sdk

// The following requires are needed for logging purposes
var uuid = require( 'uuid' );
var vcapServices = require( 'vcap_services' );
var basicAuth = require( 'basic-auth-connect' );

// The app owner may optionally configure a cloudand db to track user input.
// This cloudand db is not required, the app will operate without it.
// If logging is enabled the app must also enable basic auth to secure logging
// endpoints
var cloudantCredentials = vcapServices.getCredentials( 'cloudantNoSQLDB' );
var cloudantUrl = null;
if ( cloudantCredentials ) {
  cloudantUrl = cloudantCredentials.url;
}
cloudantUrl = cloudantUrl || process.env.CLOUDANT_URL; // || '<cloudant_url>';
var logs = null;
var app = express();

// Bootstrap application settings
app.use( express.static( './public' ) ); // load UI from public folder
app.use( bodyParser.json() );

// Create the service wrapper
var conversation = new Watson( {
  // If unspecified here, the CONVERSATION_USERNAME and CONVERSATION_PASSWORD env properties will be checked
  // After that, the SDK will fall back to the bluemix-provided VCAP_SERVICES environment property
  // username: '<username>',
  // password: '<password>',
  url: 'https://gateway.watsonplatform.net/conversation/api',
  version_date: '2016-09-20',
  version: 'v1'
} );

function isEmpty(obj) {
  return !Object.keys(obj).length > 0;
}

function randomInt (low, high) {
    return Math.floor(Math.random() * (high - low) + low);
}

// Reset context, when dialog node == 'conversation_restart'
function resetContext(data) {
console.log("\tresetContext");
    var reset_context = false;
    try {
        var nodes_visited = data.output.nodes_visited;
        if (nodes_visited.length > 0) {
            for (var i = 0; i < nodes_visited.length; i++) {
                if (nodes_visited[i] == 'conversation_restart') {
                    reset_context = true;
                    break;
                }
            }
        }
    }
    catch (err) {
        console.log("\tException: " + err);
    }

    if (reset_context) {
        var id = data.context.conversation_id;
        data.context = {
            'conversation_id': '',
            'system': {
              'dialog_stack': [
                {
                  'dialog_node': 'root'
                }
              ],
              'dialog_turn_counter': 1,
              'dialog_request_counter': 1,
              'branch_exited': true,
              'branch_exited_reason': 'completed'
            }
        };
        data.context.conversation_id = id;
    }
}

function processConfirmation(data) {
console.log("\tprocessConfirmation");
console.log("\t\tintents: " + data.intents[0].intent);
console.log("\t\tproduct: " + data.context.product);

    if (data.intents.length > 0 && data.intents[0].intent == 'confirm_yes') {
        if (data.context.product != "") {
            var msg = "Your new " + data.context.product + " account number is " + randomInt(10000000, 19999999);
            data.output.text = msg + '\n' + data.output.text;
        }
    }
}

function processBalance(data) {
console.log("\tprocessBalance");
    if (Array.isArray(data.output.text)) {
        for (var i = 0; i < data.output.text.length; i++) {
            data.output.text[i] = data.output.text[i].replace("{BALANCE}", randomInt(1000000, 5000000));
        }
    }
    else
        data.output.text = data.output.text.replace("{BALANCE}", + randomInt(1000000, 5000000));
}

function processBranch(data) {
console.log("\tprocessBranch");
    if (data.intents.length > 0 && data.intents[0].intent != 'location_branch')
        return;
    else
        data.context.location_branch = true;

    var location = '';
    var location = '';
    if (data.entities.length > 0 && data.entities[0].entity == 'sys-location')
        location = data.entities[0].value;

    if (data.entities.length > 0 && data.entities[0].entity == 'sys-location')
        location = data.entities[0].value;

console.log("\t\tintents:  " + data.intents[0].intent);
console.log("\t\tlocation: " + location);

    var env = JSON.parse(process.env.VCAP_SERVICES);
    var db2 = env['dashDB'][0].credentials;
    
    var conString = "DRIVER={DB2};DATABASE=" + db2.db + ";UID=" + db2.username + ";PWD=" + db2.password + ";HOSTNAME=" + db2.hostname + ";port=" + db2.port;

    var result = '';
    var ibmdb = require('ibm_db');
    try {
        var con = ibmdb.openSync(conString);
        var sql = "SELECT * FROM BRANCH WHERE UPPER(CITY) LIKE '" + location.toUpperCase() + "%' OR ADDRESS LIKE '%" + location.toUpperCase() + "' FETCH FIRST 10 ROWS ONLY";
        console.log("\t\tsql = " + sql);

        var rows = con.querySync(sql);
        for (var i = 0; i < rows.length; i++) {
            result += i+1 + '. ' + rows[i].ADDRESS + ' Phone: ' + rows[i].PHONE + '\n';
        }
        console.log(result);
        data.output.text = result;
        con.close(function() {
            console.log("Connection closed successfully");
        });
    }
    catch (err) {
        console.log("Error", err);
    }
}

function processOutput(data, callback) {
    processConfirmation(data),
    processBalance(data),
    processBranch(data),
    resetContext(data)

    callback(false, data);
    console.log('Done!');
}

// Endpoint to be call from the client side
app.post( '/api/message', function(req, res) {
  var workspace = process.env.WORKSPACE_ID || '<workspace-id>';
  if ( !workspace || workspace === '<workspace-id>' ) {
    return res.json( {
      'output': {
        'text': 'The app has not been configured with a <b>WORKSPACE_ID</b> environment variable. Please refer to the ' +
        '<a href="https://github.com/watson-developer-cloud/conversation-simple">README</a> documentation on how to set this variable. <br>' +
        'Once a workspace has been defined the intents may be imported from ' +
        '<a href="https://github.com/watson-developer-cloud/conversation-simple/blob/master/training/car_workspace.json">here</a> in order to get a working application.'
      }
    } );
  }
  var payload = {
    workspace_id: workspace,
    context: {},
    input: {}
  };
  if ( req.body ) {
    if ( req.body.input ) {
      payload.input = req.body.input;
    }
    if ( req.body.context ) {
      // The client must maintain context/state
      payload.context = req.body.context;
    }
  }

console.log("+++ translate input");
  if ( payload.input.text ) {
    // Google Translate Conversation Request
    googleTranslate.translate(payload.input.text, languageTo, function(err, translation) {
      if (err) 
        return res.status( err.code || 500 ).json( err );
    
      var originalInputText = payload.input.text;
      payload.input.text = translation.translatedText;
      
      // Send the input to the conversation service
      conversation.message( payload, function(err, data) {
        if ( err ) {
          return res.status( err.code || 500 ).json( err );
        }

        // Handle Watson Conversation Output
console.log("+++ processOutput");
        processOutput(data, function(err, data) {

            // Google Translate Conversation Response
            var outputText = '';
            if (Array.isArray(data.output.text)) {
                for (var i = 0; i < data.output.text.length; i++)
                    outputText += data.output.text[i] + '\n';
            }
            else
                outputText = data.output.text;

console.log("+++ translate output");
            googleTranslate.translate(outputText, languageFrom, function(err, translation) {
              if ( err ) {
                return res.status( err.code || 500 ).json( err );
              }
              data.output.originalText = data.output.text;
              data.output.text = translation.translatedText;
              data.input.originalText = originalInputText;
              return res.json( updateMessage( payload, data ) );
            } );
        } );
      } );
    } );
  }
} );

/**
 * Updates the response text using the intent confidence
 * @param  {Object} input The request to the Conversation service
 * @param  {Object} response The response from the Conversation service
 * @return {Object}          The response with the updated message
 */
function updateMessage(input, response) {
  var responseText = null;
  var id = null;
  if ( !response.output ) {
    response.output = {};
  } else {
    if ( logs ) {
      // If the logs db is set, then we want to record all input and responses
      id = uuid.v4();
      logs.insert( {'_id': id, 'request': input, 'response': response, 'time': new Date()});
    }
    return response;
  }
  if ( response.intents && response.intents[0] ) {
    var intent = response.intents[0];
    // Depending on the confidence of the response the app can return different messages.
    // The confidence will vary depending on how well the system is trained. The service will always try to assign
    // a class/intent to the input. If the confidence is low, then it suggests the service is unsure of the
    // user's intent . In these cases it is usually best to return a disambiguation message
    // ('I did not understand your intent, please rephrase your question', etc..)
    if ( intent.confidence >= 0.75 ) {
      responseText = 'I understood your intent was ' + intent.intent;
    } else if ( intent.confidence >= 0.5 ) {
      responseText = 'I think your intent was ' + intent.intent;
    } else {
      responseText = 'I did not understand your intent';
    }
  }
  response.output.text = responseText;
  if ( logs ) {
    // If the logs db is set, then we want to record all input and responses
    id = uuid.v4();
    logs.insert( {'_id': id, 'request': input, 'response': response, 'time': new Date()});
  }
  return response;
}

if ( cloudantUrl ) {
  // If logging has been enabled (as signalled by the presence of the cloudantUrl) then the
  // app developer must also specify a LOG_USER and LOG_PASS env vars.
  if ( !process.env.LOG_USER || !process.env.LOG_PASS ) {
    throw new Error( 'LOG_USER OR LOG_PASS not defined, both required to enable logging!' );
  }
  // add basic auth to the endpoints to retrieve the logs!
  var auth = basicAuth( process.env.LOG_USER, process.env.LOG_PASS );
  // If the cloudantUrl has been configured then we will want to set up a nano client
  var nano = require( 'nano' )( cloudantUrl );
  // add a new API which allows us to retrieve the logs (note this is not secure)
  nano.db.get( 'car_logs', function(err) {
    if ( err ) {
      console.error(err);
      nano.db.create( 'car_logs', function(errCreate) {
        console.error(errCreate);
        logs = nano.db.use( 'car_logs' );
      } );
    } else {
      logs = nano.db.use( 'car_logs' );
    }
  } );

  // Endpoint which allows deletion of db
  app.post( '/clearDb', auth, function(req, res) {
    nano.db.destroy( 'car_logs', function() {
      nano.db.create( 'car_logs', function() {
        logs = nano.db.use( 'car_logs' );
      } );
    } );
    return res.json( {'message': 'Clearing db'} );
  } );

  // Endpoint which allows conversation logs to be fetched
  app.get( '/chats', auth, function(req, res) {
    logs.list( {include_docs: true, 'descending': true}, function(err, body) {
      console.error(err);
      // download as CSV
      var csv = [];
      csv.push( ['Question', 'Intent', 'Confidence', 'Entity', 'Output', 'Time'] );
      body.rows.sort( function(a, b) {
        if ( a && b && a.doc && b.doc ) {
          var date1 = new Date( a.doc.time );
          var date2 = new Date( b.doc.time );
          var t1 = date1.getTime();
          var t2 = date2.getTime();
          var aGreaterThanB = t1 > t2;
          var equal = t1 === t2;
          if (aGreaterThanB) {
            return 1;
          }
          return  equal ? 0 : -1;
        }
      } );
      body.rows.forEach( function(row) {
        var question = '';
        var intent = '';
        var confidence = 0;
        var time = '';
        var entity = '';
        var outputText = '';
        if ( row.doc ) {
          var doc = row.doc;
          if ( doc.request && doc.request.input ) {
            question = doc.request.input.text;
          }
          if ( doc.response ) {
            intent = '<no intent>';
            if ( doc.response.intents && doc.response.intents.length > 0 ) {
              intent = doc.response.intents[0].intent;
              confidence = doc.response.intents[0].confidence;
            }
            entity = '<no entity>';
            if ( doc.response.entities && doc.response.entities.length > 0 ) {
              entity = doc.response.entities[0].entity + ' : ' + doc.response.entities[0].value;
            }
            outputText = '<no dialog>';
            if ( doc.response.output && doc.response.output.text ) {
              outputText = doc.response.output.text.join( ' ' );
            }
          }
          time = new Date( doc.time ).toLocaleString();
        }
        csv.push( [question, intent, confidence, entity, outputText, time] );
      } );
      res.csv( csv );
    } );
  } );
}

module.exports = app;

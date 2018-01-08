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

var express = require('express'); // app server
var bodyParser = require('body-parser'); // parser for post requests
var Conversation = require('watson-developer-cloud/conversation/v1'); // watson sdk

var app = express();

// Bootstrap application settings
app.use(express.static('./public')); // load UI from public folder
app.use(bodyParser.json());

// Create the service wrapper
var conversation = new Conversation({
  // If unspecified here, the CONVERSATION_USERNAME and CONVERSATION_PASSWORD env properties will be checked
  // After that, the SDK will fall back to the bluemix-provided VCAP_SERVICES environment property
  //'username': process.env.CONVERSATION_USERNAME,
  //'password': process.env.CONVERSATION_PASSWORD,
  'version_date': '2017-05-26'
});

// Endpoint to be call from the client side
app.post('/api/message', function(req, res) {
  var workspace = process.env.WORKSPACE_ID || '<workspace-id>';
  if (!workspace || workspace === '<workspace-id>') {
    return res.json({
      'output': {
        'text': 'The app has not been configured with a <b>WORKSPACE_ID</b> environment variable. Please refer to the ' + '<a href="https://github.com/watson-developer-cloud/conversation-simple">README</a> documentation on how to set this variable. <br>' + 'Once a workspace has been defined the intents may be imported from ' + '<a href="https://github.com/watson-developer-cloud/conversation-simple/blob/master/training/car_workspace.json">here</a> in order to get a working application.'
      }
    });
  }
  var payload = {
    workspace_id: workspace,
    context: req.body.context || {},
    input: req.body.input || {}
  };

  var params = {
    workspace_id: workspace,
    page_limit: 1000,
  };

  var TINTS = process.env.TOP_INTENTS           || "OFF";
  var TINUM = process.env.TOP_INTENTS_NUM       || undefined;
  var TIMOD = process.env.TOP_INTENTS_MODE      || "TANAKA3";
  var TIEXL = process.env.TOP_INTENTS_EXCL      || null;
  var TILST = process.env.TOP_INTENTS_MODE_LIST || null;

  //CountIntents()の再帰呼び出しのための定義
  var rData;
  var intents = {};

  // Send the input to the conversation service
  conversation.message(payload, function(err, data) {
    if (err) return res.status(err.code || 500).json(err);
    if (req.body.input == null && TINTS === "ON") {
		 if (TIMOD === "TANAKA3" || TIMOD === "OTHER") {
		 	rData = data;
       	conversation.getLogs(params, CountIntents);
		 } else if (TIMOD === "LIST" && TILST) {
			 return res.json(makeIntentsList(JSON.parse(TILST), JSON.parse(TIEXL), null, data, TINUM));
		 } else return res.json(updateMessage(payload, data));
    } else return res.json(updateMessage(payload, data));
  });

  // CountIntents() : Callback func of getLogs()
  function CountIntents(err, response) {
    if (err) console.error(err);
    else {
       response.logs.forEach(function(conv) {
          conv.response.intents.forEach(function(intent) {
             //集計処理 -> 連想配列として生成する
             if (intents[intent.intent] == undefined)
                intents[intent.intent] = 1;
             else
                intents[intent.intent] += 1;
          });
       });
       var url = response.pagination.next_url;
		 if (url) {
		 	 var Pcursor='cursor=';
          var pos1 = url.indexOf('cursor=');
          if (pos1 !== -1) {
		 		 var pos2 = url.indexOf('&', pos1+Pcursor.length);
		 		 params.cursor = url.substr(pos1+Pcursor.length, pos2-pos1-Pcursor.length);
             conversation.getLogs(params, CountIntents); // 再帰処理
          }
       } else {
          var topIntents = [];
          //連想配列から配列に変換
          for(var key in intents) {
             var tmp = { "intent":key, "match":intents[key] };
             topIntents.push(tmp);
          }
          //降順ソート
          topIntents.sort(function(a, b) {
             if (a.match > b.match) return -1;
             if (a.match < b.match) return 1;
             return 0;
          });
			 //intentsリストを作成する
          var intentsList = [];
          for(var key in topIntents) 
             intentsList.push(topIntents[key].intent);

		 	 if (TIMOD === "TANAKA3") var reg = /^[SDE]_(.*)/; //田中さんのintent構造化ルールに一致する
			 else var reg = null;

		 	 return res.json(makeIntentsList(intentsList, JSON.parse(TIEXL), reg, rData, TINUM));
       }
    }
  };
});

function makeIntentsList(list, elist, regExp, data, number) {
	if (regExp === null) regExp = /(.*)/;
	var j = 0;
	var buttonList = "<div>";
	list.forEach(function(value, i) {
		if (value = value.match(regExp)) {
			//console.log("value[0]: ", value[0]);
			//console.log("value[1]: ", value[1]);
			if (elist === null || elist.indexOf(value[0]) == -1 )
         	//指定した数分を抽出して、intentsのリストを作成する
				if ( number == undefined || j < number) {
					buttonList += "<button type='button' class='intents' onclick='ConversationPanel.clickButton(\"" + value[1] + "\")'>" + value[1] + "</button><br>";
					j++;
				}
			}
	});
	buttonList += "</div>";
	
	data.output.text = data.output.text[0];
	data.output.text += "<br><br>-- よく利用されている質問はこちら--<br>";
	data.output.text += buttonList;
	return data;
}

/**
 * Updates the response text using the intent confidence
 * @param  {Object} input The request to the Conversation service
 * @param  {Object} response The response from the Conversation service
 * @return {Object}          The response with the updated message
 */
function updateMessage(input, response) {
  var buttonList;
  if (response.context.answer_type === "candidate_list") {
  	  buttonList = "<div>";
	  response.context.candidate_list.forEach(function(value, i) {
		  buttonList += "<button type='button' class='intents' onclick='ConversationPanel.clickButton(\"" + value + "\")'>" + value + "</button><br>";
	  });
	  buttonList += "</div>";
  }

  var responseText = null;
  if (!response.output) {
    response.output = {};
  } else {
	 if (buttonList) {
    	response.output.text = response.output.text + "<br><br>" + buttonList;
	 }
    return response;
  }
  if (response.intents && response.intents[0]) {
    var intent = response.intents[0];
    // Depending on the confidence of the response the app can return different messages.
    // The confidence will vary depending on how well the system is trained. The service will always try to assign
    // a class/intent to the input. If the confidence is low, then it suggests the service is unsure of the
    // user's intent . In these cases it is usually best to return a disambiguation message
    // ('I did not understand your intent, please rephrase your question', etc..)
    if (intent.confidence >= 0.75) {
      responseText = 'I understood your intent was ' + intent.intent;
    } else if (intent.confidence >= 0.5) {
      responseText = 'I think your intent was ' + intent.intent;
    } else {
      responseText = 'I did not understand your intent';
    }
  }
  response.output.text = responseText;
  return response;
}

module.exports = app;

"use strict"

const http =  require('http');
const fs =  require('fs');
const parseString = require('xml2js').parseString;
const simplesmtp = require('simplesmtp');
const isDigit = new RegExp("^\\d+$");

const conf = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

function setRead(msg, completed) {
  //console.log(msg);
  let postData = [
    '<?xml version:"1.0" encoding="UTF-8"?>',
    "<request>",
    "<Index>"+msg.Index+"</Index>",
    "</request>"
  ].join("\n");
  let options = {
    hostname: conf.StickIP || "192.168.8.1",
    port: 80,
    path: '/api/sms/set-read',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  let req = http.request(options, (res) => {
    let data = [];
    //console.log(`STATUS: ${res.statusCode}`);
    //console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      data.push(chunk);
    });
    res.on('end', () => {
      completed();
    })
  });

  req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
    completed();
  });

  req.write(postData);
  req.end();
}

function toMsg(xml) {
  let ret = {}
  for (let i in xml) {
    if (xml[i][0].match(isDigit)) {
      ret[i] = parseInt(xml[i][0], 10);
    } else {
      ret[i] = xml[i][0];
    }
  }
  return ret;
}


function observerSmsSource(pollInterval, newSmsCb) {
  function run() {
    let postData = [
      '<?xml version:"1.0" encoding="UTF-8"?>',
      "<request>",
      "<PageIndex>1</PageIndex>",
      "<ReadCount>20</ReadCount>",
      "<BoxType>1</BoxType>",
      "<SortType>0</SortType>",
      "<Ascending>0</Ascending>",
      "<UnreadPreferred>0</UnreadPreferred>",
      "</request>"
    ].join("\n");
    let options = {
      hostname: conf.StickIP || "192.168.8.1",
      port: 80,
      path: '/api/sms/sms-list',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    let req = http.request(options, (res) => {
      let data = [];
      //console.log(`STATUS: ${res.statusCode}`);
      //console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data.push(chunk);
      });
      res.on('end', () => {
        let str = data.join("");
        //console.log(str);
        parseString(str, (err, result) => {
          if (err) {
            console.error(err);
            setTimeout(run, pollInterval);
            return
          }
          result = result.response.Messages[0].Message;
          let completed = 0;
          for(let i = 0; i < result.length; ++i) {
            newSmsCb(toMsg(result[i]), () => {
              if (++completed >= result.length) {
                setTimeout(run, pollInterval);
              }
            })
          }
        });
      })
    });

    req.on('error', (e) => {
      console.error(`problem with request: ${e.message}`);
      setTimeout(run, pollInterval);
    });

    req.write(postData);
    req.end();
  }
  run();
}

observerSmsSource(10000, (msg, completed) => {
  if (msg.Smstat != 0) {
    completed();
    return;
  }
  let client = simplesmtp.connect(conf.SmtpPort || 587, conf.SmtpHost, {
    auth: conf.SmtpAuth
  })
  client.once("idle", () => {
    client.useEnvelope({
      from: conf.SmtpFrom || conf.SmtpTo[0],
      to: conf.SmtpTo
    });
  });
  client.on("rcptFailed", function(addresses){
    console.error("The following addresses were rejected: ", addresses);
    completed();
  });
  client.on("error", function(error){
    console.error(error);
    completed();
  });
  client.on("message", function(){
    client.write([
        "Subject: SMS-From "+msg.Phone,
        "Date: "+(new Date()).toUTCString(),
        "From: "+(conf.SmtpFrom||conf.SmtpTo[0]),
        "To: "+conf.SmtpTo.join(","),
        "Message-Id: <"+(new Date).getTime()+"."+msg.Index+"@sms2mail>",
        "",
        "Recv-Date: "+msg.Date,
        msg.Content,
        ""
    ].join("\n"));
    client.end();
  });
  client.on("ready", (success, response) => {
    if(success){
      console.error("The message was transmitted successfully with "+response);
      setRead(msg, completed);
      //completed();
    } else {
      completed();
    }
  });
});

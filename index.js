const mysql = require('mysql');
const express = require('express');
const session = require('express-session');
const cookieSession = require('cookie-session')
const exphbs  = require('express-handlebars');
const bodyParser = require('body-parser');
const path = require('path');
const argon2 = require('argon2');
const fs = require('fs');
const dirTree = require("directory-tree");
const winston = require('winston');
const child = require('child_process');
const sanitize = require("sanitize-filename");

const config = require('./config.json');

var mail = require('sendmail')({
	devHost:'localhost',
	devPort: 25,
	silent: true
});


var ulogger = winston.createLogger({
	format: winston.format.combine(
	    winston.format.timestamp(),
	    winston.format.json()
	),
	transports: [
		new winston.transports.File({ filename: 'log/users.log'}),
	]
});

var fblogger = winston.createLogger({
	format: winston.format.combine(
	    winston.format.timestamp(),
	    winston.format.json()
	),
	transports: [
		new winston.transports.File({ filename: 'log/feedback.log'}),
	]
});

var jserrorlogger = winston.createLogger({
	format: winston.format.combine(
	    winston.format.timestamp(),
	    winston.format.json()
	),
	transports: [
		new winston.transports.File({ filename: 'log/jserrors.log'}),
	]
});

var dbc;
function handleDisconnect() {
    dbc = mysql.createConnection(config.db);
    dbc.connect( function onConnect(err) {
        if (err) {
            console.log('Error when connecting to database:', err);
            setTimeout(handleDisconnect, 10000);
        }
    });

    dbc.on('error', function onError(err) {
        console.log('Database error. Reconnecting.', err);
        if (err.code == 'PROTOCOL_CONNECTION_LOST' || err.code == 'ECONNRESET') {
            handleDisconnect();
        } else {
            throw err;
        }
    });
}
handleDisconnect();

var app = express();
app.engine('handlebars', exphbs());
app.set('view engine', 'handlebars');
app.use("/songs", express.static(path.join(__dirname, '/songs')));
app.use(express.static(path.join(__dirname, '/static')));
app.use("/jquery", express.static(path.join(__dirname, '/node_modules/jquery/dist')));
app.use("/bootstrap", express.static(path.join(__dirname, '/node_modules/bootstrap/dist')));
app.use("/fa", express.static(path.join(__dirname, '/node_modules/font-awesome')));
app.use("/md", express.static(path.join(__dirname, '/node_modules/markdown-it/dist')));
app.use("/bowser", express.static(path.join(__dirname, '/node_modules/bowser')));
app.use("/opus-recorder", express.static(path.join(__dirname, '/node_modules/opus-recorder/dist')));
app.use("/waveform-playlist", express.static(path.join(__dirname, '/waveform-playlist/dist/waveform-playlist')));

app.use(cookieSession({
  name: 'session',
  keys: [config.sessionKey],

  // Cookie Options
  maxAge: 24 * 60 * 60 * 1000 // 24 hours
}));

var rawparser = bodyParser.raw({limit: '1000mb', type: "application/octet-stream"});
var urlencoded = bodyParser.urlencoded({extended : true});
var json = bodyParser.json();

app.get('/', function(req, res) {
	if (req.session.loggedin) {
		if(req.session.username != "lars.funke")
		ulogger.log('info', 'Page loaded by ' + req.session.username + ', ip ' + req.headers['x-forwarded-for']);
		//TODO: Optimize this!
		var tree = dirTree("songs");
		var data = {songs: null};
		data.songs = tree.children.map((a) => ({
			name: a.name, 
			audio: a.children.filter(a => a.name != "Text.md").map(a => ({src: a.path, name: a.name.split('.')[0]})),
			text: a.children.filter(a => a.name == "Text.md").map(a => a.path)[0]
		}));
		res.render('player', {
			session: req.session, 
			song: tree.children.map(a => a.name), 
			resources: JSON.stringify(data),
			enableUpload: config.enableUpload
		});
	} else {
		var err = '';
		if(req.session.loginError) {
			err = 'Login fehlgeschlagen.';
			req.session.loginError = false;
		}
		res.render('login', {error: err});
	}
	//response.end();
});

app.get('/deauth', function(req, res){
	req.session = null;
	res.redirect('/');
});

app.post('/auth', urlencoded, json, async function(request, response) {
	var username = request.body.username;
	var password = request.body.password;
	if (username == "demo" && password == "demo") {
		request.session.loggedin = true;
		request.session.username = "demo";
		request.session.firstname = "Demo User";
		return response.redirect('/');
	}

	if (username && password) {
		dbc.query('SELECT first_name, last_name, passwd, mail FROM members WHERE username = ? ', [username], async function(error, results, fields) {
			if(error)
				console.error(error);

			if (results.length > 0) {
				var correct = await argon2.verify(results[0]['passwd'], password).catch((err) => { console.log(err); });;
				if(correct) {
					request.session.loggedin = true;
					request.session.username = username;
					request.session.firstname = results[0]['first_name'];
					request.session.lastname = results[0]['last_name'];
					request.session.mail = results[0]['mail'];
				} else {
					request.session.loginError = true;
				}
			} else {
				request.session.loginError = true;
			}
			ulogger.log('warn', (request.session.loggedin?'':'Failed ') + 'login by ' + username + ', ip ' + request.headers['x-forwarded-for']);
			response.redirect('/');
		});
	} else {
		response.redirect('/');
	}
	
});

app.post('/feedback', urlencoded, json, function(req, res) {
	mail({
       from: req.session.firstname + ' ' + req.session.lastname + ' <' + req.session.mail + '>' || 'noone@musicollective.de',
       to: 'Lars Funke <lars@musicollective.de>',
       subject: '[Digitale Probe] Feedback von ' + req.session.firstname,
       html: req.body.msg + '<br /><br />' + req.body.ua + '<br /><br />' + JSON.parse(req.body.con).join("<br />")
   	},
   	function(err,response){
      if(err){
         console.log("Mail error:" + err);
      }
	});
	fblogger.log('info', req.session.username + ': ' + req.body.msg + ' ' + req.body.ua)
	res.json('success');
});

app.post('/jserror', urlencoded, json, function(req, res) {
	req.body.data.user = req.session.username;
	jserrorlogger.log('error', req.body.data);
	res.json('ok');
});

app.post('/upload', rawparser, function(req, res) {
	var ar = parseInt(req.header('X-Samplerate')) || 44100;
	var song = req.header('X-Song') || '';
	var proc = child.spawn('ffmpeg', [
	  '-f', 'f32le',
	  '-ar', ar,
	  '-i', '-',
	  '-c:a', 'flac',
	  '-compression_level', '11',
	  'uploads/'+ (new Date).toISOString() + ' ' + req.session.username + ' - ' + sanitize(song) +'.flac'
	]);

	proc.stdin.write(req.body);
	proc.stdin.end();

	proc.on('close', (code) => {
	  if(code == 0)
	  	res.json("ok");
	  else
	  	res.json("not ok");
	});
});

app.listen(config.port);

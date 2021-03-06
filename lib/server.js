// system dependancies
var http	= require('http');
var socket_io	= require('../vendor/socket.io-node');

// constants (not yet used)
var ctx	= {}

ctx.CANVAS_W	= 300;
ctx.CANVAS_H	= 150;

ctx.RACKET_H	= 15* 1/ctx.CANVAS_W;
ctx.RACKET_W	= 5 * 1/ctx.CANVAS_H;

ctx.LIMIT_UP		= 0;
ctx.LIMIT_DOWN		= 1;
ctx.LIMIT_LEFT		= 0;
ctx.LIMIT_RIGHT		= 1;

ctx.LIMIT_RACKET_L	= ctx.LIMIT_LEFT  + (12*1/ctx.CANVAS_W);	// TODO those constant depends
ctx.LIMIT_RACKET_R	= ctx.LIMIT_RIGHT - (12*1/ctx.CANVAS_W);


/**
 * Represent a ball in the server
*/
var Ball	= function(ctor_opts){
	//////////////////////////////////////////////////////////////////////////
	//		class variables						//
	//////////////////////////////////////////////////////////////////////////
	// copy ctor_opts + set default values if needed
	var position	= ctor_opts.position	|| { x: 0.5, y: 0.5 };
	var vector	= ctor_opts.vector	|| { angle: Math.PI/5, speed: 0.03};

	//////////////////////////////////////////////////////////////////////////
	//		misc							//
	//////////////////////////////////////////////////////////////////////////
	var tickNow	= function(){
		//console.log("tick ball angle", vector.angle, "dy", Math.sin(vector.angle), "pos y", position.y)
		position.x	+= Math.cos(vector.angle) * vector.speed;
		position.y	+= Math.sin(vector.angle) * vector.speed;
	}
	/**
	 * return the game context for this player
	*/
	var gameCtx	= function(){
		return {
			x	: position.x,
			y	: position.y
		}
	}

	//////////////////////////////////////////////////////////////////////////
	//		run initialisation					//
	//////////////////////////////////////////////////////////////////////////
	// return public properties
	return {
		position	: position,
		vector		: vector,
		tickNow		: tickNow,
		gameCtx		: gameCtx
	}
}

/**
 * Represent a Player in the server
*/
var Player	= function Player(ctor_opts){
	//////////////////////////////////////////////////////////////////////////
	//		class variables						//
	//////////////////////////////////////////////////////////////////////////
	// copy ctor_opts + set default values if needed
	var ioClient	= ctor_opts.ioClient	|| console.assert(false);
	var side	= ctor_opts.side	|| console.assert(false);
	var position	= ctor_opts.position	|| { y: 0.5 };
	var score	= ctor_opts.score	|| 0;
	var eventCb	= ctor_opts.eventCb	|| function(event){};
	// sanity check - check parameters
	console.assert( ['left', 'right'].indexOf(side) != -1 );
	console.assert( typeof score == "number" );
	// private variables
	var lastInput	= null;

	//////////////////////////////////////////////////////////////////////////
	//		ctor/dtor						//
	//////////////////////////////////////////////////////////////////////////
	var ctor	= function(){
		ioClientCtor();
	}
	var dtor	= function(){
		ioClientDtor();
	}

	//////////////////////////////////////////////////////////////////////////
	//		ioClient						//
	//////////////////////////////////////////////////////////////////////////
	var ioClientCtor	= function(){
		ioClient.on('message', ioClientOnMessage);
		ioClient.on('disconnect', ioClientOnDisconnect);
	}
	var ioClientDtor	= function(){
		console.dir(ioClient);
		ioClient.close();
		ioClient	= null;
	}
	var ioClientOnMessage	= function(msg_json){
		var message	= JSON.parse(msg_json);
		if( message.type == "userInput" ){
			lastInput	= message.data;
			position	= { y: message.data.y }
		}
	}
	var ioClientOnDisconnect= function(){
		eventCb('disconnect');
	}
	var ioClientSend	= function(data){
		ioClient.send(JSON.stringify(data));
	}
	var ioClientId		= function(){
		return ioClient.sessionId;
	}
	
	//////////////////////////////////////////////////////////////////////////
	//		misc							//
	//////////////////////////////////////////////////////////////////////////
	var incScore	= function(){
		score	+= 1;
	}
	var tickNow	= function(){
		
	}
	/**
	 * return the game context for this player
	*/
	var gameCtx	= function(){
		return {
			score	: score,
			y	: position.y
		}
	}
	
	// return true if the ball is colliding with the racket
	var collideBall	= function(ball_old_pos, ball_new_pos){
		var limitLeft	= 0;
		var limitRight	= 1;
		var racketH	= 15*1/150;
		var limitRacketL= limitLeft  + (12*1/300);	// TODO those constant depends
		var limitRacketR= limitRight - (12*1/300);
		var limitRacketU= position.y - racketH/2;
		var limitRacketD= position.y + racketH/2;
		var o	= ball_old_pos;
		var n	= ball_new_pos;
		var i	= {
			x:	side === 'left' ? limitRacketL : limitRacketR,
			y:	null
		}
		
		// determine if ball is going thru the limitRacket
		var sign	= function(x){ return x < 0 ? -1 : 1 }
		if( sign(o.x-i.x) == sign(n.x-i.x) )	return false;

		// compute i.x
		// - basic equation OIx/ONx = OIy/ONy
		// - OIy = i.x - o.x = ONy*OIx/ONx
		i.y	= o.y + (n.y-o.y) * (i.x-o.x) / (n.x-o.x);

		// return false if the interception y is out of the racket
		if( i.y < limitRacketU )	return false;
		if( i.y > limitRacketD )	return false;

		// if all previous tests passed, return true
		return true;
	}

	//////////////////////////////////////////////////////////////////////////
	//		run initialisation					//
	//////////////////////////////////////////////////////////////////////////
	// call the contructor
	ctor();	
	// return public properties
	return {
		destroy		: dtor,
		position	: position,
		side		: side,
		score		: score,
		ioClientId	: ioClientId,
		incScore	: incScore,
		send		: ioClientSend,
		tickNow		: tickNow,
		gameCtx		: gameCtx,
		collideBall	: collideBall
	}
}

/**
 * @class Represent a game on the server
*/
var Game	= function Game(ctor_opts){
	//////////////////////////////////////////////////////////////////////////
	//		class variables						//
	//////////////////////////////////////////////////////////////////////////
	// copy ctor_opts + set default values if needed
	var tickPeriod	= ctor_opts.tickPeriod	|| 50.0;
	// private variables
	var LEFT	= 0;
	var RIGHT	= 1;
	var players	= [];
	var MsgType	= require('./msg_type');
	var StateMachine= require('./state_machine');
	var GameState	= require('./game_state');
	var gameId	= Math.floor(Math.random()*999999)

	//////////////////////////////////////////////////////////////////////////
	//		ctor/dtor						//
	//////////////////////////////////////////////////////////////////////////
	var ctor	= function(){
		ioClientCtor();
		stateCtor();
	}
	var dtor	= function(){
		stateDtor();
		playersDtor();
	}

	//////////////////////////////////////////////////////////////////////////
	//		StateMachine						//
	//////////////////////////////////////////////////////////////////////////
	var curState	= require('./state_machine').create();
	var stateTimer	= null;
	var stateCtor	= function(){
		curState.register(GameState.PRES_PAGE);
		curState.register(GameState.GAME_READY	, stGameReadyEnter	, stGameReadyEnter	);
		curState.register(GameState.BALL_INIT);
	}
	var stateDtor	= function(){
		clearTimeout(stateTimer);
		stateTimer	= null;
	}
	var gotoState	= function(newState, args){
		// close to debug
		console.log("newState", newState, "args", args);
		// change curState
		curState.gotoState(newState, args);
		// forward a MsgType.STATE_CHANGE to players
		playersSend({
			type	: MsgType.STATE_CHANGE,
			data	: {
				'newState'	: newState,
				'args'		: args
			}
		});
	}
	var stGameReadyEnter	= function(args){
		console.log("gameready enter");
		setTimeout(function(){
			gotoState(GameState.BALL_INIT);
		}, 3*1000);
	}
	var stGameReadyLeave	= function(){
		console.log("gameready leave");
		clearTimeout(stateTimer);
		stateTimer	= null;
	}

	//////////////////////////////////////////////////////////////////////////
	//		misc							//
	//////////////////////////////////////////////////////////////////////////
	/**
	 * Return true if this game isFull
	*/
	var isFull	= function(){
		return playerCount() == 2;	
	}
	/**
	 * Return the number of players
	*/
	var playerCount	= function(){
		return players.length;
	}
	var playersDtor	= function(){
		players.forEach(function(player){
			player.destroy();
		});		
	}
	/** Send a message to all connected players
	*/
	var playersSend	= function(message){
		players.forEach(function(player){
			player.send(message);
		});
	}
	var playerEventCb	= function(player, event){
		console.log("player", player.ioClientId(), "event", event);
		if(event == 'disconnect'){
			gotoState( GameState.GAME_OVER, 'otherLeft');
			gamesRemove(gameId);
		}
	}
	/**
	 * Add a new player
	*/
	var ioClientAdd	= function(ioClient){
		console.log("add a client")
		// sanity check 
		console.assert( !isFull() );
		console.assert( playerCount() != 2 );
		// create the new player
		var player	= new Player({
			ioClient	: ioClient,
			side		: playerCount() == LEFT ? 'left' : 'right',
			eventCb		: function(event){ playerEventCb(player, event); }
		})
		// add the new player
		players.push(player);
		// state change
		if( playerCount() == 1 ){
			gotoState( GameState.PRES_PAGE );
		}else{
			var args	= {};
			args[players[0].ioClientId()]	= players[0].side;
			args[players[1].ioClientId()]	= players[1].side;
			gotoState( GameState.GAME_READY, args);
		}
	}
	
	
	//////////////////////////////////////////////////////////////////////////
	//		Only for GameState.BALL_MOVING				//
	//////////////////////////////////////////////////////////////////////////
	
	var gameStart	= function(){
		console.log("game start")
		// create the ball
		ball	= new Ball({});
		// notify both players that the game is starting
		playersSend({
			type	: "alert",
			data	: "Connected"
		});
		// start ticking		
		setTimeout(tickNow, tickPeriod)
	}

	var tickNow	= function(){
		//console.log("tick")
		// tick all players
		players.forEach(function(player){
			player.tickNow();
		});
		// save ball_old_pos
		var ball_old_pos	= {
			x	: ball.position.x,
			y	: ball.position.y
		};
		// tick the ball
		ball.tickNow();

		// start of init collision
		var limitUp	= 0;
		var limitDown	= 1;
		var limitLeft	= 0;
		var limitRight	= 1;
		var limitRacketL= limitLeft  + (12*1/300);	// TODO those constant depends
		var limitRacketR= limitRight - (12*1/300);
		if( ball.position.y < limitUp ){
			ball.position.y		= limitUp + (limitUp - ball.position.y)
			ball.vector.angle	= -ball.vector.angle;
			console.assert(ball.position.y);
		}else if( ball.position.y > limitDown ){
			ball.position.y		= limitDown + (limitDown - ball.position.y)
			ball.vector.angle	= -ball.vector.angle;
			console.assert(ball.position.y);
		}else if( ball.position.x > limitRight ){
			// TODO ball loose
		}else if( ball.position.x < limitLeft ){
			// TODO ball loose
		}
		
		// test collision with each player
		var ball_new_pos	= ball.position;
		if( players[LEFT].collideBall(ball_old_pos, ball_new_pos) ){
			ball.position.x		= limitRacketL + (limitRacketL - ball.position.x)
			ball.vector.angle	= Math.PI/2 + (Math.PI/2 - ball.vector.angle);
		} else if( players[RIGHT].collideBall(ball_old_pos, ball_new_pos) ){
			ball.position.x		= limitRacketR + (limitRacketR - ball.position.x)
			ball.vector.angle	= Math.PI/2 + (Math.PI/2 - ball.vector.angle);
		}

		// build gameCtx
		var gameCtx	= {
			players	: [
				players[0].gameCtx(),
				players[1].gameCtx(),
			],
			ball	: ball.gameCtx()
		}		
		// send gameCtx to each Player
		playersSend({
			type	: MsgType.GAME_CTX,
			data	: gameCtx
		});
		
		// go on ticking
		// - FIXME isnt that uselessly drifting ?
		setTimeout(tickNow, tickPeriod);
	}

	//////////////////////////////////////////////////////////////////////////
	//		run initialisation					//
	//////////////////////////////////////////////////////////////////////////
	// return public properties
	return {
		ioClientAdd	: ioClientAdd,
		isFull		: isFull,
		gameId		: gameId,
		destroy		: dtor
	};
}


/** Store all the current Games
*/
var games	= [];

/** Find a game which isnt full
*/
var gamesFindNotFull	= function(){
	for(var i = 0; i < games.length; i++){
		var game	= games[i];
		if( game.isFull() === false )	return game;
	}
	var game	= new Game({});
	games.push(game);
	return game;
}
/** Remove a game from games array
*/
var gamesRemove		= function(gameId){
	var i;
	for(i = 0; i < games.length; i++){
		if( games[i].gameId == gameId )	break;
	}
console.log("")
	console.assert( i < games.length );
	var game	= games[i];
	game.destroy();
	games.slice(i, 1);
}

/**
 * The mainLoop of the server
*/
var mainLoop	= function(){	
	// socket.io listener to accept websocket
	var server = http.createServer(function(req, res){});
	server.listen(8080);
	var io_listener	= socket_io.listen(server, {});
	//var io_listener	= io.listen(server, {log : function(msg){}});		
	io_listener.on('connection', function(ioClient){
		var game	= gamesFindNotFull();
		game.ioClientAdd(ioClient);
	});
}

mainLoop();
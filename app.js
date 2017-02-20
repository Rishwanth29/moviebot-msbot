// var config = require('./config.js');
var builder = require('botbuilder');
var movieDB = require('moviedb')(process.env.moviedb_key);
var restify = require('restify');
var wordsToNum = require('words-to-num');
var request = require('superagent');
require('datejs');
var genres = require('./genres.js');

//setup Server
var server = restify.createServer();
server.listen(process.env.PORT || process.env.PORT || 3978, () =>
  console.log('%s listening to %s', server.name, server.url)
);

//setup Connector
var connector = new builder.ChatConnector({
  appId: process.env.appID,
  appPassword: process.env.appPassword
})
var bot = new builder.UniversalBot(connector);
server.post('/api/messages', connector.listen());

//setup LUIS
var luisURL = 'westus.api.cognitive.microsoft.com/luis/v2.0/apps';
var luisModeURL = `https://${luisURL}/${process.env.LUIS_APP_ID}/?subscription-key=${process.env.LUIS_API_KEY}`;

var recognizer = new builder.LuisRecognizer(luisModeURL);

var intents = new builder.IntentDialog({ recognizers : [recognizer] }); // note array of models, can pass in multiple
bot.dialog('/', intents);

var imgBaseUrl = 'https://image.tmdb.org/t/p/';
var posterSize = 'w185';


var getMovie = (session) => {
  // Send typing message
  session.sendTyping();

  var params = {};
  if(session.dialogData.genre){
    params.with_genres = session.dialogData.genre;
  }
  if (session.dialogData.sort){
    params.sort_by = session.dialogData.sort === 'popularity' ? 'popularity.desc' : 'vote_average.desc';
  }
  if(session.dialogData.year){
    params.primary_release_year = session.dialogData.year;
  }

  // Call the Movie DB API passing the params object from above
  movieDB.discoverMovie(params, (err, res) => {
    var msg = new builder.Message(session);
    // If there's no error
    if (!err) {
      var movies = res.results;
      var number = session.dialogData.number ? session.dialogData.number : 1;
      var startIndex = 0;
      var maxMoviesToShow = 10;

      if ( number > maxMoviesToShow ){
        number = maxMoviesToShow;
        session.send(`Sorry, I can only show the first ${maxMoviesToShow} movies:\n\n`);
      }else if ( number === 1 ){
        startIndex = Math.floor(Math.random() * maxMoviesToShow);
        number = startIndex + 1;
      }

      var cards = []; // holds movie cards

      movies.slice(startIndex, number).forEach((movie) => {
        var card = new builder.HeroCard(session);
        card.title(movie.title);
        card.text(movie.overview);
        card.buttons([
          builder.CardAction.openUrl(session, `https://www.themoviedb.org/movie/${movie.id}`, 'Movie Info'),
        ]);

        if(movie.poster_path){
          var imgUrl = `${imgBaseUrl}${posterSize}${movie.poster_path}`;
          card.images([
            builder.CardImage.create(session, imgUrl)
              .tap(builder.CardAction.showImage(session, imgUrl)),
          ]);
        }
        cards.push(card);
      });

      msg.attachmentLayout(builder.AttachmentLayout.carousel).attachments(cards);
    } else {
      msg.text(`Oops, an error, can you please say 'movie' again?`);
    }
    // End the dialog
    session.endDialog(msg);
  });
};


// initial Intents
intents.matches('Hello', [
  (session, args, next) => {
    if(!session.userData.name) {
      session.beginDialog('/askName');
    }else{
      next();
    }
  },
  session =>
    builder.Prompts.text(session, `Hi ${session.userData.name}, How are you?`),
    (session, results) => {
      request
        .post('https://westus.api.cognitive.microsoft.com/text/analytics/v2.0/sentiment')
        .send({
          documents: [
            {
              language: 'en',
              id: '1',
              text: results.response,
            },
          ],
        })
        .set('Ocp-Apim-Subscription-Key', process.env.Ocp_Apim_Key)
        .set('Content-Type', 'application/json')
        .end((err, res) => {
          if(!err){
            console.log(res.body);
            if(res.body.documents[0].score > 0.6){
              session.send('Good');
            }else{
              session.send(`I'm sorry you feel that way, maybe a Comedy will cheer you up?`);
              session.dialogData.genre = genres.comedy.id;
              getMovie(session);
            }
          }
          session.send('I know About All Movies, just ask Anytime!');
        })
    }
])
// LUIS.ai can't match better
.matches('None', (session) => {
  session.send(`Sorry I didn't understand, I'm a bot`);
})
// user message matches intent 'movie'
.matches('Movie', [
  (session, args, next) => {
    var genreEntity = builder.EntityRecognizer.findEntity(args.entities, 'genre');
    var sortPopularityEntity = builder.EntityRecognizer.findEntity(args.entities, 'sort::popularity');
    var numberEntity = builder.EntityRecognizer.findEntity(args.entities, 'builtin.number');
    var dateEntity = builder.EntityRecognizer.findEntity(args.entities, 'builtin.datetime.date');

    if(genreEntity){
      var match = builder.EntityRecognizer.findBestMatch(genres, genreEntity.entity);
      var genreObj = match ? genres[match.entity] : null;
      session.dialogData.genre = genreObj ? genreObj.id : null;
    }
    if(dateEntity){
      var date = Date.parse(dateEntity.resolution.date);
      session.dialogData.year = date ? date.getFullYear() : null;
    }
    if(numberEntity){
      var num = wordsToNum.convert(numberEntity.entity);
      session.dialogData.number = session.dialogData.year === num ? 1: num;
    }
    session.dialogData.sort = sortPopularityEntity ? 'popularity' : 'votes';

    next();
  },
  (session, results, next) => {
    if(!session.dialogData.year){
      session.beginDialog('/yearPrompt');
    }else{
      next();
    }
  },
  (session, results) => {
    if(results && results.response){
      session.dialogData.year = results.response;
    }
    getMovie(session);
  }
]);


// BOT DIALOGS BELOW

bot.dialog('/askName', [
  session =>
    builder.Prompts.text(session, `Hi! I'm MovieBot. What's your name?`),
  (session, results) => {
    // Store the user's name on the userData session attribute
    session.userData.name = results.response;
    session.endDialog();
  },
]);


bot.dialog('/yearPrompt', [
  session =>
    builder.Prompts.text(session, `Enter a release year ( YYYY )`),
  (session, results) => {
    var matched = results.response.match(/\d{4}/g);

    session.endDialogWithResult({ response: matched });
  }
]);

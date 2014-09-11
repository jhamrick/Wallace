wallaceUrl = "http://localhost:5000/";
xMax = 100;

if (Meteor.isClient) {

  Session.set("N", -1);

  Session.set("trialsCompleted", -1);
  Session.set("isConsensual", false);
    Meteor.call(
        "allAgents",
        function (error, results) {
            allAgents = EJSON.parse(results.content).agents;
            Session.set("allAgents", allAgents);
        }
    );

  Handlebars.registerHelper("isCompleted", function() {
    return Session.get("trialsCompleted") === Session.get("N");
  });
    Handlebars.registerHelper("isNewParticipant", function() {
        if (amplify.store("agentUUID") === undefined) {
            return true;
        } else {
            return !contains(Session.get("allAgents"), amplify.store("agentUUID"));
        }
    });

  Template.completionCode.code = function () {
    return Session.get("agentUUID");
  };

  Template.header.isTestingPhase = function () {
    return Session.get("trialsCompleted") >= Session.get("N")/2;
  };

  Template.header.thisTrial = function () {
    N = Session.get("N");
    trialIndex = bounds(Session.get("trialsCompleted"), 0, N);
    if(trialIndex < N/2) {
      return trialIndex + 1;
    } else {
      return bounds(trialIndex + 1 - N/2, 0, N/2);
    }
  };

  Template.header.numTrials = function () {
    return Session.get("N")/2;
  };

  Template.gameInterface.created = function () {

    paper = Raphael(0, 50, 600, 400);

    // Draw the X bar.
    stimulusX = paper.rect(50, 50, 0, 25);
    stimulusX.attr("fill", "#D95B43");
    stimulusX.attr("stroke", "none");
    stimulusX.hide();

    // Draw the Y bar.
    stimulusY = paper.rect(450, 400, 25, 0);
    stimulusY.attr("fill", "#53777A");
    stimulusY.attr("stroke", "none");
    stimulusY.hide();

    // Draw the feedback bar.
    feedback = paper.rect(500, 400, 25, 0);
    feedback.attr("fill", "#CCCCCC");
    feedback.attr("stroke", "none");
    feedback.hide();
  };

  Template.gameInterface.interface = function () {

    if(Session.get("trialsCompleted") >= 0) {
      PPU = 3;  // Scaling of the stimulus

      // Adjust the X bar.
      if(Session.get("trialsCompleted") < Session.get("N")/2) {
        x = xTrain[Session.get("trialsCompleted")];
      } else {
        x = xTest[Session.get("trialsCompleted") - N/2];
      }
      stimulusXSize = x * PPU;
      stimulusX.attr({ width: stimulusXSize });

      // Adjust the Y bar.
      stimulusYSize = bounds(400 - Session.get("mouseY"), 1*PPU, xMax*PPU);
      stimulusY.attr({ y: 400 - stimulusYSize,
                  height: stimulusYSize });

      // Show the feedback bar.
      if(Session.get("enteredResponse") &&
        !Session.get("finishedTheTrial") &&
        (Session.get("trialsCompleted") < Session.get("N")/2)) {
        y = yTrain[Session.get("trialsCompleted")];
        feedback.attr({ y: 400 - y * PPU, height: y * PPU });
        feedback.show();
      }
    }
  };

  // Track the mouse.
  $(document).mousemove( function(e) {
    Session.set("mouseX", e.pageX);
    Session.set("mouseY", e.pageY-50);
  });

  proceedToNextTrial = function () {
    stimulusX.hide();
    stimulusY.hide();
    feedback.hide();
    Mousetrap.resume();
    Session.set("finishedTheTrial", true);
  };

  // Listens for clicks (entered responses) and acts accordingly.
  $(document).mousedown( function(e) {

    trialIndex = Session.get("trialsCompleted");

    // Record the click if it's a response, check it if it's a correction.
    if(trialIndex >= 0 && trialIndex < N) {

      respondedAt = now();

      // Record the current response in natural units.
      yNow = stimulusYSize/PPU;
      yTrue = yTrain[trialIndex];

      if(!Session.get("enteredResponse")) {
        // add response to db
        if(trialIndex < N/2){ // Is it training?
          yTrainReported.push(yNow);
        } else {
          yTest.push(yNow);
        }
        Session.set("enteredResponse", true);

        // If this is a test trial, then there's no feedback, so we're done.
        if(trialIndex >= N/2) {
          proceedToNextTrial();
        }

      } else {
        if(Math.abs(yNow - yTrue) < 5) {
          proceedToNextTrial();
        } else { // Show animation for failed correction.
          feedback.animate({fill: "#666"}, 100, "<", function () {
            this.animate({fill: "#CCC"}, 100, ">");
          });
        }
      }
    }
  });

  Template.instructionsAndConsent.rendered = function () {
    $("#consentModal").modal('show');
  };

  // Runs an individual trial of the function learning tast.
  showNextStimulus = function () {

    // Clean up the stimuli from the previous trial, update state.
    Mousetrap.pause();
    Session.set("trialsCompleted", Session.get("trialsCompleted")+1);
    Session.set("enteredResponse", false);
    Session.set("finishedTheTrial", false);

    // If the experiment is over, display the completion code.
    if(Session.get("trialsCompleted") === N) {
        console.log("Experiment completed.");
        Mousetrap.pause();
        paper.remove();

        // JSONify the data for exporting
        var testData = {};
        for(var i in xTest) {
            testData[xTest[i]] = yTest[i];
        }
        contentsOut = JSON.stringify(testData);
        console.log(contentsOut);
        Meteor.call(
            'createInfo',
            Session.get("agentUUID"),
            contentsOut,
            function (error, result) {
                console.log(error);
                console.log(result);
            }
        );

        // Eventually, this is where you'll
        // ask MTurk to send out another HIT.

    } else {
      // Record the current time.
      presentedAt = now();

      stimulusX.attr({width: 0});
      stimulusX.show();
      stimulusY.show();
    }
  };

  // Once the user gives consent, we set up the experiment.
  Template.instructionsAndConsent.events({

    "click #giveConsent": function(event) {
      console.log("Participant consented.");
      Session.set("isConsensual", true);

      // TODO: Put these nested calls on the server side.
      Meteor.call("createAgent", function(error, results) {
        agent_content = EJSON.parse(results.content);
        Session.set("agentUUID", agent_content.agents.uuid);

        // Get this participant's training and test data.
        Meteor.call(
            "getPendingTransmissions",
            Session.get("agentUUID"),
            function(error, results) {
                transmission_content = EJSON.parse(results.content);
                t_uuid = transmission_content.transmissions[0].info_uuid;

                Meteor.call(
                    "getInfo",
                    t_uuid,
                    function (error, results) {
                        info_content = EJSON.parse(results.content);
                        data = EJSON.parse(info_content.contents);
                        xTrain = Object.keys(data).map(
                            function (x) {
                                return parseInt(x, 10);
                            }
                        );

                        yTrain = Object.keys(data).map(
                            function (x) {
                                return parseInt(data[x], 10);
                            }
                        );

                      Session.set("N", 2 * xTrain.length);
                      var N = Session.get("N"); // Total number of trials
                      assert(N%4 === 0, "Number of trials must be divisible by 4.");

                      allX = range(1, xMax);
                      xTestFromTraining = randomSubset(xTrain, N/4);
                      xTestNew = randomSubset(allX.diff(xTrain), N/4);
                      xTest = shuffle(xTestFromTraining.concat(xTestNew));
                      yTrainReported = [];
                      yTest = [];

                      Mousetrap.bind("space", showNextStimulus, "keydown");
                    }
                );
            }
        );
      }
  );
    }
  });
}

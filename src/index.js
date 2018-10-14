/*!
 * @License INTERACTION WORKSPACE.web edition
 * Copyright (c) 2014-2017 Genesys Telecommunications Laboratories
 * All rights reserved.
 * FILE NAME:          wwe-service-client-api.js
 */
/* jshint maxdepth:8 */

const axios = require('axios');

if (!window.genesys) { window.genesys = {}; }
if (!window.genesys.wwe) { window.genesys.wwe = {}; }
if (!window.genesys.wwe.service) {
	/**
	 * This is the WWE service client API.
	 * @constructor ServiceClientAPI
	 */
	var ServiceClientAPI = function () {
		/*
		 * To prevent security issue the argument "*" in the postMessage has to be replaced by the Workspace Web Edition host to avoid a vulnerability issue.
		 * "*" should be replaced with "http://<my-wwe-server>".
		 */
		var postMessageOrigin = "*";

		var self = this,
			debug = true,
			theWWEWindow = null,
			protocolVersion = 2;

		// Public members

		/**
		 * Cleanup the object.
		 */
		this.unload = function () {
			var requestedEventsClone = requestedEvents.slice(0);
			for (var i = 0; i < requestedEventsClone.length; i++) {
				removeEventRequest(requestedEventsClone[i]);
			}
			requestedEvents = requestedEventsClone = [];
			window.removeEventListener("message", receiveMessage, false);
		};

		/**
		 * Parse a received command.
		 * @param {Window} sourceWindow The DOM source window of the message.
		 * @param {object} message The message to parse.
		 * @param {string} message.request The request.
		 * @param {object} [message.referenceId] An optional string pass in the answer event.
		 * @return {string} A reference identifier in case of a requested value.
		 */
		this.sendMessage = function (message, successCallback, failedCallback) {
			if (!message.referenceId) { message.referenceId = "" + currentReferenceId++; }
			postMessageToParentFrame(message);
			if (successCallback) {

				var newEventRequest = {
					referenceId: message.referenceId,
					promiseSuccessCallback: successCallback,
					promiseFailedCallback: failedCallback,
					timeoutToken: 0,
					callerThis: this
				};
				requestedEvents.push(newEventRequest);

				// After a 10 seconds timeout, the event with the specify referenceId is not found,
				// so, we reject the request.
				newEventRequest.timeoutToken = setTimeout(function () {
					try {
						if (failedCallback) {
							failedCallback("Request timeout");
						}
					} catch (e) {
						console.error("ServiceClientAPI: Error while resolving a requested event: " + e.toString());
					}
					removeEventRequest(newEventRequest);
				}, 10000);
			}
			return message.referenceId;
		};

		/**
		 * Subscribe to an events.
		 * @param {string|string[]} event The event name or an array of event name.
		 * @param {function} callback The callback function called when an event arrive.
		 * @param {object} [context] An optional context object to call the callback function with.
		 * @return {object} Itself.
		 */
		this.subscribe = function (event, callback, context) {
			this.sendMessage({
				event: "subscribe",
				data: event
			}, function (data) {
				// SUCCEEDED
				var subscription = {
					event: event,
					callback: callback,
					context: context,
					subscriptionId: data.subscriptionId
				};
				subscriptionsByCallback[callback] = subscription;
				if (Array.isArray(event)) {
					event.forEach(function (e) {
						subscriptionsByEventName[e] = subscription;
					});
				} else {
					subscriptionsByEventName[event] = subscription;
				}

			}, function () {
				// FAILED
				console.error("ServiceClientAPI: Cannot subscribe to this event: " + event);
			});
			return this;
		};

		/**
		 * Unsubscribe to an events.
		 * @param {string} event The event name.
		 * @param {function} callback The callback function called when an event arrive.
		 * @return {object} Itself.
		 */
		this.unsubscribe = function (callback) {
			var subscription = subscriptionsByCallback[callback];
			if (subscription) {
				delete subscriptionsByCallback[callback];
				if (Array.isArray(subscription.event)) {
					subscription.event.forEach(function (e) {
						delete subscriptionsByEventName[subscription.event];
					});
				} else {
					delete subscriptionsByEventName[subscription.event];
				}
				this.sendMessage({
					event: "unsubscribe",
					data: subscription.subscriptionId
				});
			}
			return this;
		};

		/**
		* 
		* @param {Window} sourceWindow The DOM source IFRAME embendding Workspace Web Edition.
		*/
		this.targetWWEWindow = function (window) {
			theWWEWindow = window;
		};

		// Private members

		var currentReferenceId = 0,
			requestedEvents = [],
			subscriptionsByCallback = {},
			subscriptionsByEventName = {};

		/**
		 * Parse a received command.
		 * @param {object} message The message to parse.
		 * @private
		 */
		var postMessageToParentFrame = function (message) {
			message = message || {};
			message.userAgent = "WWE Client";
			message.protocolVersion = protocolVersion;
			if (this.frameId !== undefined) {
				message.frameId = this.frameId;
			}
			if (theWWEWindow) {
				theWWEWindow.postMessage(message, postMessageOrigin);
			} else if (window.opener) {
				window.opener.postMessage(message, postMessageOrigin);
			} else {
				window.parent.postMessage(message, postMessageOrigin);
			}
		};

		/**
		 * Remove the internal eventRequest object from the pending requestedEvents list.
		 * @param {object} eventRequest The internal eventRequest object.
		 * @return {boolean} true if the eventRequest has been found and removed; false otherwise.
		 * @private
		 */
		var removeEventRequest = function (eventRequest) {
			var pos = requestedEvents.indexOf(eventRequest);
			if (pos != -1) {
				requestedEvents.splice(pos, 1);
				if (eventRequest.timeoutToken) {
					clearTimeout(eventRequest.timeoutToken);
					eventRequest.timeoutToken = 0;
				}
				return true;
			}
			return false;
		};

		/**
		 * Handle global postMessage events.
		 * @param {object} message The received message event.
		 * @private
		 */
		var receiveMessage = function (message) {
			if (message && message.data && message.data.userAgent && message.data.userAgent.indexOf("WWE") != -1) {

				if (debug && (typeof JSON !== 'undefined') && JSON.stringify) { console.log("ServiceClientAPI: receiveMessage: " + JSON.stringify(message.data, null, '\t')); }
				if (message.data.event) {
					// We receive a subscribed event
					var subscription = subscriptionsByEventName[message.data.event];
					if (subscription) {
						try {
							subscription.callback.call(subscription.context || this, message.data);
						} catch (e) {
							console.error("Error while calling the event handler for event '" + message.data.event + "', " + e.toString());
						}
					}
				} else if (message.data.referenceId) {
					// We receive a request response
					for (var i = 0; i < requestedEvents.length; i++) {
						var requestedEvent = requestedEvents[i];
						if (requestedEvent && requestedEvent.referenceId == message.data.referenceId) {
							// Request found
							if (message.data.errorMessage !== undefined) {
								// This is a failure
								if (requestedEvent.promiseFailedCallback) {
									try {
										if (message.data) {
											delete message.data.referenceId;
										}
										requestedEvent.promiseFailedCallback.call(requestedEvent.callerThis, message.data);
									} catch (e) {
										console.error("Error in the failed callback: " + e.toString());
									}
								}
							} else if (requestedEvent.promiseSuccessCallback) { // This is a success
								try {
									if (message.data) {
										delete message.data.referenceId;
									}
									requestedEvent.promiseSuccessCallback.call(requestedEvent.callerThis, message.data);
								} catch (e) {
									console.error("Error in the success callback: " + e.toString());
								}
							}
							removeEventRequest(requestedEvent);
						}
					}
				} else if (message.data.frameId !== undefined) {
					this.frameId = message.data.frameId;
				}
			} else if (window.genesys.wwe.service.onMessage && typeof (message.data) == "string" && message.data.indexOf("wwe") === 0) {
				window.genesys.wwe.service.onMessage(message.data);
			}
		};

		window.addEventListener("message", receiveMessage, false);

		this.handleInteractionEvt = async function (evtData) {
			const currentState = await getSuperGuacState();
			if (evtData.data.eventType === "RINGING" && currentState.PhoneState !== "Ringing") {
				await setSuperGuacState({ PhoneState: "Ringing" });
			} else if (evtData.data.eventType === "ESTABLISHED" && currentState.PhoneState !== "Call") {
				await setSuperGuacState({ PhoneState: "Call" });
			} else if (evtData.data.eventType === "HELD" && currentState.PhoneState !== "Hold") {
				await setSuperGuacState({ PhoneState: "Hold" });
			} else if (evtData.data.eventType === "RELEASED" && currentState.PhoneState !== "Idle") {
				await setSuperGuacState({ PhoneState: "Idle" });
			} else if (evtData.data.eventType === "DIALING" && currentState.PhoneState !== "Dialing") {
				await setSuperGuacState({ PhoneState: "Dialing" });
			}
		}

		this.handleAgentEvt = async function (evntData) {
			const newState = { AgentState: null };

			const currentState = await getSuperGuacState();
			if (evntData.data.type === "READY" && currentState.AgentState !== "READY") {
				newState.AgentState = "READY";
			} else if (evntData.data.type === "NOT_READY" && currentState.AgentState !== "NOT_READY") {
				newState.AgentState = "NOT_READY";
			} else if (evntData.data.type === "NOT_READY_AFTER_CALLWORK" && currentState.AgentState !== "NOT_READY_AFTER_CALLWORK") {
				newState.AgentState = "NOT_READY_AFTER_CALLWORK";
			} else if (evntData.data.type === "DND_ON" && currentState.AgentState !== "DND_ON") {
				newState.AgentState = "DND_ON";
			} else if (evntData.data.type === "LOGOUT" && currentState.AgentState !== "LOGOUT") {
				newState.AgentState = "LOGOUT";
			}

			await setSuperGuacState(newState);
		}
	};


	window.genesys.wwe.service = new ServiceClientAPI();



	var service = window.genesys.wwe.service;

	service.agent = {
		get: function (successCallback, failedCallback) {
			service.sendMessage({ request: "agent.get" }, successCallback, failedCallback);
		},
		getStateList: function (successCallback, failedCallback) {
			service.sendMessage({ request: "agent.getStateList" }, successCallback, failedCallback);
		},
		setState: function (stateListIndex, successCallback, failedCallback) {
			service.sendMessage({ request: "agent.setState", parameters: [stateListIndex] }, successCallback, failedCallback);
		},
		getState: function (successCallback, failedCallback) {
			service.sendMessage({ request: "agent.getState" }, successCallback, failedCallback);
		}
	};

	service.interaction = {
		getInteractions: function (successCallback, failedCallback) {
			service.sendMessage({ request: "interaction.getInteractions" }, successCallback, failedCallback);
		},
		getByInteractionId: function (interactionId, successCallback, failedCallback) {
			service.sendMessage({ request: "interaction.getByInteractionId", parameters: [interactionId] }, successCallback, failedCallback);
		},
		setUserData: function (interactionId, keyValues, successCallback, failedCallback) {
			service.sendMessage({ request: "interaction.setUserData", parameters: [interactionId, keyValues] }, successCallback, failedCallback);
		},
		deleteUserData: function (interactionId, key, successCallback, failedCallback) {
			service.sendMessage({ request: "interaction.deleteUserData", parameters: [interactionId, key] }, successCallback, failedCallback);
		},
		selectCaseByCaseId: function (caseId, successCallback, failedCallback) {
			service.sendMessage({ request: "interaction.selectCaseByCaseId", parameters: [caseId] }, successCallback, failedCallback);
		},
		markdone: function (interactionId, successCallback, failedCallback) {
			service.sendMessage({ request: "interaction.markdone", parameters: [interactionId] }, successCallback, failedCallback);
		},
		blockMarkdone: function (interactionId, warningMessage, successCallback, failedCallback) {
			service.sendMessage({ request: "interaction.blockMarkdone", parameters: [interactionId, warningMessage] }, successCallback, failedCallback);
		},
		unblockMarkdone: function (interactionId, successCallback, failedCallback) {
			service.sendMessage({ request: "interaction.unblockMarkdone", parameters: [interactionId] }, successCallback, failedCallback);
		}

	};

	service.voice = {
		dial: function (destination, userData, successCallback, failedCallback) {
			if (userData && typeof userData == "function") {
				failedCallback = successCallback;
				successCallback = userData;
				userData = null;
			}
			service.sendMessage({ request: "voice.dial", parameters: [destination, userData] }, successCallback, failedCallback);
		},
		answer: function (interactionId, successCallback, failedCallback) {
			service.sendMessage({ request: "voice.answer", parameters: [interactionId] }, successCallback, failedCallback);
		},
		hold: function (interactionId, successCallback, failedCallback) {
			service.sendMessage({ request: "voice.hold", parameters: [interactionId] }, successCallback, failedCallback);
		},
		resume: function (interactionId, successCallback, failedCallback) {
			service.sendMessage({ request: "voice.resume", parameters: [interactionId] }, successCallback, failedCallback);
		},
		hangUp: function (interactionId, successCallback, failedCallback) {
			service.sendMessage({ request: "voice.hangUp", parameters: [interactionId] }, successCallback, failedCallback);
		},
		startCallRecording: function (interactionId, successCallback, failedCallback) {
			service.sendMessage({ request: "voice.startCallRecording", parameters: [interactionId] }, successCallback, failedCallback);
		},
		stopCallRecording: function (interactionId, successCallback, failedCallback) {
			service.sendMessage({ request: "voice.stopCallRecording", parameters: [interactionId] }, successCallback, failedCallback);
		},
		pauseCallRecording: function (interactionId, successCallback, failedCallback) {
			service.sendMessage({ request: "voice.pauseCallRecording", parameters: [interactionId] }, successCallback, failedCallback);
		},
		resumeCallRecording: function (interactionId, successCallback, failedCallback) {
			service.sendMessage({ request: "voice.resumeCallRecording", parameters: [interactionId] }, successCallback, failedCallback);
		}
	};

	service.sipEndpoint = {
		muteMicrophone: function (successCallback, failedCallback) {
			service.sendMessage({ request: "sipEndpoint.muteMicrophone" }, successCallback, failedCallback);
		},
		unmuteMicrophone: function (successCallback, failedCallback) {
			service.sendMessage({ request: "sipEndpoint.unmuteMicrophone" }, successCallback, failedCallback);
		},
		muteSpeaker: function (successCallback, failedCallback) {
			service.sendMessage({ request: "sipEndpoint.muteSpeaker" }, successCallback, failedCallback);
		},
		unmuteSpeaker: function (successCallback, failedCallback) {
			service.sendMessage({ request: "sipEndpoint.unmuteSpeaker" }, successCallback, failedCallback);
		},
		isMicrophoneMute: function (successCallback, failedCallback) {
			service.sendMessage({ request: "sipEndpoint.isMicrophoneMute" }, successCallback, failedCallback);
		},
		isSpeakerMute: function (successCallback, failedCallback) {
			service.sendMessage({ request: "sipEndpoint.isSpeakerMute" }, successCallback, failedCallback);
		}
	};

	service.email = {
		create: function (destination, userData, successCallback, failedCallback) {
			if (userData && typeof userData == "function") {
				failedCallback = successCallback;
				successCallback = userData;
				userData = null;
			}
			service.sendMessage({ request: "email.create", parameters: [destination, userData] }, successCallback, failedCallback);
		}
	};

	service.media = {
		setState: function (mediaName, stateListIndex, successCallback, failedCallback) {
			service.sendMessage({ request: "media.setState", parameters: [mediaName, stateListIndex] }, successCallback, failedCallback);
		},
		getMediaList: function (successCallback, failedCallback) {
			service.sendMessage({ request: "media.getMediaList" }, successCallback, failedCallback);
		},
		getMediaByName: function (name, successCallback, failedCallback) {
			service.sendMessage({ request: "media.getMediaByName", parameters: [name] }, successCallback, failedCallback);
		}
	};

	service.system = {
		getAllowedServices: function (successCallback, failedCallback) {
			service.sendMessage({ request: "system.getAllowedServices" }, successCallback, failedCallback);
		},
		triggerActivity: function (successCallback, failedCallback) {
			service.sendMessage({ request: "system.triggerActivity" }, successCallback, failedCallback);
		},
		popupToast: function (parameters, successCallback, failedCallback) {
			service.sendMessage({ request: "system.popupToast", parameters: [parameters] }, successCallback, failedCallback);
		},
		updateToast: function (id, parameters, successCallback, failedCallback) {
			service.sendMessage({ request: "system.updateToast", parameters: [id, parameters] }, successCallback, failedCallback);
		},
		closeToast: function (id, successCallback, failedCallback) {
			service.sendMessage({ request: "system.closeToast", parameters: [id] }, successCallback, failedCallback);
		}
	};

	var CachedState;
	console.log("Initializing the super-guac server");
	initSuperGuac();
	async function initSuperGuac() {
		await genesys.wwe.service.agent.getState(async result => {
			console.log("result", result);

			const state = {
				PhoneState: "Idle",
				AgentState: await result.data.type
			};
			console.log("super-guac init: ", state)
			await setSuperGuacState(state);
		});

		// start polling super-guac for state changes
		window.setInterval(() => handleSuperGuacStateChange(), 100);
	}

	async function getSuperGuacState() {
		const url = "https://super-guacamole.herokuapp.com/";
		const result = await axios({
			method: "GET",
			url: url + "get-state",
		})

		return result.data;
	}

	async function setSuperGuacState(state) {
		const url = "https://super-guacamole.herokuapp.com/";
		const serverResult = await axios({
			method: "POST",
			url: url + "set-state",
			data: state
		});
		console.log("super-guac set-state:", serverResult);
		CachedState = serverResult;
	}

	async function handleSuperGuacStateChange() {
		state = await getSuperGuacState();
		if (state.PhoneState === "Dialing") {
			console.log("state", state);
			console.log("cachedstate: ", CachedState);
		}
		// phone state changes
		if (CachedState.PhoneState !== state.PhoneState) {
			console.log("super-guac handleSuperGuacStateChange state:", state);
			console.log("super-guac handleSuperGuacStateChange state:", CachedState);

			if (state.PhoneState === "Idle") {
				genesys.wwe.service.voice.hangUp("1", succeeded, failed);
			} else if (state.PhoneState === "Hold") {
				genesys.wwe.service.voice.hold("1", succeeded, failed);
			} else if (state.PhoneState === "Call" && CachedState.PhoneState === "Hold") {
				genesys.wwe.service.voice.resume("1", succeeded, failed);
			} else if (state.PhoneState === "Call" === CachedState.PhoneState === "Ringing") {
				genesys.wwe.service.voice.answer("1", succeeded, failed);
			} else if (state.PhoneState === "Dialing") {
				genesys.wwe.service.voice.dial(state.Number, null, succeeded, failed);
			}
		}
		// agent state changes 
		else if (CachedState.AgentState === state.AgentState) {

		}

		CachedState = state;
	}
} 
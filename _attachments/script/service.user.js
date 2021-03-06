/*
 Copyright 2013 Kevin Gaudin (kevin.gaudin@gmail.com)

 This file is part of Acralyzer.

 Acralyzer is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 Acralyzer is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with Acralyzer.  If not, see <http://www.gnu.org/licenses/>.
 */
(function(acralyzerConfig,acralyzer,acralyzerEvents,$) {
    "use strict";
    /**
    * Couchdb user service
    *
    * @class user
    * @singleton
    * @static
    */
    acralyzer.service('$user', ['$rootScope', '$q', '$resource', '$http', function($rootScope, $q, $resource, $http) {
        var SessionResource = $resource('/_session');
        var UserResource;

        var _hasAdminPath;
        var _session;

        /*
         * Resets the user object back to the default state
         * @method reset
         */
        var _reset = function($user) {
            /** 
             * Username of current logged in user
             *
             * @property {String} username
             * @type String
             * @readOnly
             */
            $user.username = null;
            /**
             * Is current user an admin
             *
             * @property {Boolean} isAdmin
             * @type Boolean
             * @readOnly
             */
            $user.isAdmin = false;
            /**
             * Current users roles (as object)
             *
             * @property {Object} roles
             * @type Object
             * @readOnly
             */
            $user.roles = {};
        };


        /*
         * Updates the session of the current user 
         *
         * @private
         * @method _processSession
         * @param {Promise} deferred Promise to update when completed
         */
        var _processSession = function(data) {
            if (!data) {
                return _reset($user);
            }
            if (!UserResource)
            {
                UserResource = $resource(
                    '/' + data.info.authentication_db + '/org.couchdb.user\\::name',
                    {'name':'@name'},
                    {'save': { method: 'PUT' } }
                );
            }
            /* Grab user session after login */
            var userCtx = data.userCtx;
            $user.roles = {};
            userCtx.roles.forEach(function(role) {
                $user.roles[role] = 1;
            });
            $user.isAdmin = ($user.roles['_admin'] === 1);
            $user.username = userCtx.name;
            if ($user.username) {
                $rootScope.$broadcast(acralyzerEvents.LOGGED_IN, $user);
            } else {
                $rootScope.$broadcast(acralyzerEvents.LOGGED_OUT, $user);
            }
            $rootScope.$broadcast(acralyzerEvents.LOGIN_CHANGE, $user);

            /* Does this box support changing admin passwords */
            if ($user.username && $user.isAdmin && _hasAdminPath === undefined)
            {
                $http.get('/_config/admins/' + $user.username)
                .success(function(data, status, headers, config) {
                    if (data.match(/^"-hashed-/)) {
                        _hasAdminPath = true;
                    } else {
                        _hasAdminPath = false;
                    }
                }).error(function(data, status, headers, config) {
                    _hasAdminPath = false;
                });
            }
        };

        var $user = this;
        /**
        * Logs in the user.
        *
        * @method login
        * @param {String} username Username to log in with
        * @param {String} password Password to log in username with
        *
        * @return {Promise} Promise for completion of login
        */
        $user.login = function(username, password) {
            var deferred = $q.defer();
            var data = {
                name: username,
                password: password
            };
            /* Disabled until 1.1 is stable as older couch needs x-www-form-urlencoded
             * https://github.com/angular/angular.js/issues/736
            var newSession = new SessionResource(data);
            */
            var _newSessionPromise = $http.post(
                '/_session',
                $.param(data),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                    }
                }
            );
            _newSessionPromise.then(function(sess) {
                /* Apparently admin user doesn't return the ctx properly, so lets fetch it */
                _session = SessionResource.get({}, function(a) {
                    /* success */
                    _processSession(a);
                    deferred.resolve($user);
                });
            }, function($http) {
                deferred.reject();
            });
            return deferred.promise;
        };

        /**
        * Changes the password of the currently logged in user
        *
        * Side effect: logs out user
        *
        * @method changePassword
        * @param {String} password New Password for the user
        *
        * @return {Promise} Promise for completion of change password
        */
        $user.changePassword = function(password) {
            var deferred = $q.defer();
            if (!password) {
                deferred.reject("Missing password");
                return deferred.promise;
            }

            if ($user.isAdmin && _hasAdminPath === true) {
                $http.put('/_config/admins/'+$user.username, JSON.stringify(password))
                .success(function() {
                    $user.logout();
                    deferred.resolve();
                })
                .error(function() {
                    deferred.reject(/* data.reason */);
                });
                return deferred.promise;
            }
            UserResource.get({ 'name': $user.username }, function(user) {
                user.password = password;
                user.$save(
                    function() {
                        $rootScope.$broadcast(acralyzerEvents.USER_PASSWORD_CHANGE, $user);
                        $rootScope.$broadcast(acralyzerEvents.LOGIN_CHANGE, $user);
                        $user.logout();
                        deferred.resolve();
                    },
                    function() {
                        console.log(arguments);
                        deferred.reject();
                    }
                );
            });
            return deferred.promise;
        };

        /**
        * Logout the current user
        *
        * @method logout
        * @return {Promise} Promise for completion of logout
        */
        $user.logout = function() {
            var deferred = $q.defer();
            _session.$delete(function() {
                _reset($user);
                $rootScope.$broadcast(acralyzerEvents.LOGGED_OUT, $user);
                $rootScope.$broadcast(acralyzerEvents.LOGIN_CHANGE, $user);
                deferred.resolve($user);
            }, function() {
                deferred.reject();
            });
            return deferred.promise;
        };

        /**
         * Does this install support changing passwords?
         *
         * @method canChangePassword
         * @return {Boolean} True if system can support changing password
         */
        $user.canChangePassword = function() {
            if ($user.isAdmin && !_hasAdminPath) {
                return false;
            }
            return true;
        };

        /**
         * Is the current logged in user a 'reader'
         *
         * @method isReader
         * @return {Boolean} True if user is allowed to read data
         */
        $user.isReader = function() {
            if ($user.isAdmin || $user.roles.reader) {
                return true;
            }
            return false;
        };

        /* Initialize all the variables */
        _reset($user);

        /* First time we grab our session from couchdb */
        _session = SessionResource.get({}, function(a) {
            /* success */
            _processSession(a);
        }, function() {
            alert('Unable to connect to couchdb');
            /* failure */
        });

        return $user;
    }]);

})(window.acralyzerConfig, window.acralyzer, window.acralyzerEvents, window.jQuery);

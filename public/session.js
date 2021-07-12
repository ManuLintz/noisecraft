import { assert, Dialog } from './utils.js';

let btnLogin = document.getElementById('btn_login');
let btnUser = document.getElementById('btn_user');

/// Log the user out
export function logout()
{
    localStorage.removeItem('username');
    localStorage.removeItem('userId');
    localStorage.removeItem('sessionId');

    btnLogin.style.display = 'block';
    btnUser.style.display = 'none';
}

/// Get the user id and session id or make the user log in
export async function login()
{
    let userId = localStorage.getItem('userId');
    let sessionId = localStorage.getItem('sessionId');

    if (userId)
        return [userId, sessionId];

    // Prompt the user for user name and password
    let [username, password] = await loginForm();

    // Send a login request to the server
    [userId, sessionId] = await loginRequest(username, password);

    console.log('username:', username);
    console.log('userId:', userId);

    // Show the logged in user
    btnLogin.style.display = 'none';
    btnUser.style.display = 'block';
    btnUser.textContent = username;

    // Store logged in user info
    localStorage.setItem('username', username);
    localStorage.setItem('userId', userId);
    localStorage.setItem('sessionId', sessionId);

    return [userId, sessionId];
}

/**
Send a login request to the server
*/
async function loginRequest(username, password)
{
    return new Promise((resolve, reject) => {
        let json = JSON.stringify({
            username: username,
            password: password,
        });

        var xhr = new XMLHttpRequest()
        xhr.open("POST", 'login', true);
        xhr.setRequestHeader("Content-Type", "application/json");

        // Request response handler
        xhr.onreadystatechange = function()
        {
            if (this.readyState == 4 && this.status == 200)
            {
                var resp = JSON.parse(this.responseText);
                resolve([resp.userId, resp.sessionId]);
            }

            if (this.readyState == 4 && this.status == 400)
            {
                reject();
            }
        };

        xhr.send(json);
    });
}

/**
Display the login/register form
Produces the username and password
*/
async function loginForm()
{
    var div = document.createElement('div');
    var dialog = new Dialog('Log In', div);

    var regLink = document.createElement('a');
    regLink.className = 'form_link';
    regLink.textContent = 'Register / Create New Account';
    div.appendChild(regLink);

    var paramDiv = document.createElement('div');
    paramDiv.className = 'form_div';
    let nameElem = document.createElement('input');
    nameElem.type = 'text';
    nameElem.size = 16;
    nameElem.maxLength = 16;
    paramDiv.appendChild(document.createTextNode('Username '));
    paramDiv.appendChild(nameElem);
    div.appendChild(paramDiv);

    var paramDiv = document.createElement('div');
    paramDiv.className = 'form_div';
    let passElem = document.createElement('input');
    passElem.type = 'password';
    passElem.size = 16;
    passElem.maxLength = 16;
    paramDiv.appendChild(document.createTextNode('Password '));
    paramDiv.appendChild(passElem);
    div.appendChild(paramDiv);

    var loginBtn = document.createElement('button');
    loginBtn.className = 'form_btn';
    loginBtn.appendChild(document.createTextNode('Log in'));
    div.appendChild(loginBtn);

    return new Promise((resolve, reject) => {

        regLink.onclick = async function ()
        {
            dialog.close();

            let [username, password] = await register();
            resolve([username, password]);

        }

        loginBtn.onclick = function ()
        {
            let username = nameElem.value;
            let password = passElem.value;
            dialog.close();
            resolve([username, password]);
        }
    });
}

/**
Get the user id and session id or make the user log in
Returns a promise that produces the username and password
*/
export async function register()
{
    let [username, password, email] = await registerForm();

    // Send a register request to the server
    let result = await registerRequest(username, password, email);

    return [username, password];
}

/**
Send a register request to the server
*/
async function registerRequest(username, password, email)
{
    return new Promise((resolve, reject) => {
        let json = JSON.stringify({
            username: username,
            password: password,
            email: email,
        });

        var xhr = new XMLHttpRequest()
        xhr.open("POST", 'register', true);
        xhr.setRequestHeader("Content-Type", "application/json");

        // Request response handler
        xhr.onreadystatechange = function()
        {
            if (this.readyState == 4 && this.status == 200)
            {
                var resp = JSON.parse(this.responseText);
                resolve(true);
            }

            if (this.readyState == 4 && this.status == 400)
            {
                reject();
            }
        };

        xhr.send(json);
    });
}

/**
Display the register form
Returns a promise that produces the username, password and e-mail
*/
async function registerForm()
{
    var div = document.createElement('div');
    var dialog = new Dialog('Create New Account', div);

    var paramDiv = document.createElement('div');
    paramDiv.className = 'form_div';
    let nameElem = document.createElement('input');
    nameElem.type = 'text';
    nameElem.size = 16;
    nameElem.maxlength = 16;
    paramDiv.appendChild(document.createTextNode('Username '));
    paramDiv.appendChild(nameElem);
    div.appendChild(paramDiv);

    var paramDiv = document.createElement('div');
    paramDiv.className = 'form_div';
    let passElem = document.createElement('input');
    passElem.type = 'password';
    passElem.size = 16;
    passElem.maxLength = 16;
    paramDiv.appendChild(document.createTextNode('Password '));
    paramDiv.appendChild(passElem);
    div.appendChild(paramDiv);

    var paramDiv = document.createElement('div');
    paramDiv.className = 'form_div';
    let passElem2 = document.createElement('input');
    passElem2.type = 'password';
    passElem2.size = 16;
    passElem2.maxLength = 16;
    paramDiv.appendChild(document.createTextNode('Confirm password '));
    paramDiv.appendChild(passElem2);
    div.appendChild(paramDiv);

    var paramDiv = document.createElement('div');
    paramDiv.className = 'form_div';
    let emailElem = document.createElement('input');
    emailElem.type = 'text';
    emailElem.size = 30;
    emailElem.maxLength = 32;
    paramDiv.appendChild(document.createTextNode('E-mail (optional) '));
    paramDiv.appendChild(emailElem);
    div.appendChild(paramDiv);

    var errorElem = document.createElement('div');
    errorElem.className = 'form_error';
    div.appendChild(errorElem);

    var registerBtn = document.createElement('button');
    registerBtn.className = 'form_btn';
    registerBtn.appendChild(document.createTextNode('Register'));
    div.appendChild(registerBtn);

    nameElem.onchange = function ()
    {
        let name = nameElem.value;

        if (name.trim() !== name)
        {
            errorElem.textContent = 'Invalid username';
            errorElem.style.display = 'block';
            registerBtn.disabled = true;
            return;
        }

        if (name.length == 0)
        {
            errorElem.textContent = 'Username too short';
            errorElem.style.display = 'block';
            registerBtn.disabled = true;
            return;
        }

        console.log('username ok');

        errorElem.style.display = 'none';
        registerBtn.disabled = false;
    }

    passElem2.onchange = function ()
    {
        let password = passElem.value;
        let password2 = passElem2.value;

        if (password != password2)
        {
            errorElem.textContent = 'Passwords do not match';
            errorElem.style.display = 'block';
            registerBtn.disabled = true;
            return;
        }

        if (password.length < 6)
        {
            errorElem.textContent = 'Password must be at least 6 characters'
            errorElem.style.display = 'block';
            registerBtn.disabled = true;
            return;
        }

        errorElem.style.display = 'none';
        registerBtn.disabled = false;
    }

    return new Promise((resolve, reject) => {
        registerBtn.onclick = function ()
        {
            let username = nameElem.value;
            let password = passElem.value;
            let password2 = passElem2.value;
            let email = emailElem.value;

            if (password != password2)
                return;

            dialog.close();
            resolve([username, password, email]);
        }
    });
}

/// Show the currently logged in user
function showLogin()
{
    /// User id and session id from current session
    let username = localStorage.getItem('username');

    if (!username)
        return;

    // TODO: send request to server to validate session id still valid?

    btnLogin.style.display = 'none';
    btnUser.style.display = 'block';
    btnUser.textContent = username;
}

btnLogin.onclick = login;

btnUser.onclick = logout;

// Show logged in user on startup
showLogin();
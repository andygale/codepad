function requireAuth(req, res, next) {
  if (req.session.user && req.session.user.isAuthenticated) {
    return next();
  } else {
    return res.status(401).json({ error: 'Authentication required' });
  }
}

function socketRequireAuth(socket, next) {
  const session = socket.request.session;
  if (session && session.user && session.user.isAuthenticated) {
    return next();
  } else {
    return next(new Error('Authentication required'));
  }
}

module.exports = {
  requireAuth,
  socketRequireAuth,
}; 
# AI Interaction Record

## Session 1: Scoping private auctions into a finishable feature

### Prompt

Our auction platform is working and wanted to add one more feature that would make the project more interesting without making the scope too large. We were thinking about some kind of private selling feature or social system but we do not want to turn the project into a large marketplace project.

What would be a simple way to add private auctions to our current project (We are using Node.js, Express, and PostgreSQL). Can you suggest a few ways to implement private auctions for a REST API, and for each option, explain what tables or fields might be needed and what access rules would be needed to be enforced in the backend. We want something we could finish in time so also flag which parts will be essential and which parts would probably make the feature too large.

### AI Response (trimmed summary)

The AI suggested keeping private auctions as a small access-control feature rather than building a larger private marketplace system. It outlined a few possible options:

1. **Private flag on each auction**  
   Add a `private` flag to the `auctions` table and implement rules in the backend. This was described as the most viable option.

2. **Invite list per auction**  
   Create a separate table to list which users are allowed to view or bid on a specific private auction. The AI noted that this would give finer control but would add more database logic, more UI work, and more edge cases.

3. **Follower-based private access**  
   Add a relationship between users and sellers, then allow followers to view and bid on a seller’s private auctions. The AI noted that this would still be manageable, while also making the feature more interesting than a simple hidden flag.

The AI also pointed out that some ideas would likely make the feature too large for the project timeline, such as manual approval flows, invite management screens, and changing auction privacy after creation. It recommended keeping the rules simple and enforcing them consistently in auction listing, auction detail, and bidding routes.

### What Your Team Did With It

- The useful part was that the AI compared multiple ways to support private auctions instead of pushing one fixed solution.
- We decided not to use invite lists, approval workflows, or privacy changes after creation because those options would have added too much backend logic, UI work, and testing for the available time.
- We chose a follower-based model after discussing internally and determining it it was feasible in the timeframe while making the feature more interesting than a simple hidden flag.
- We verified the final design by implementing a private auction flag, a followers table, and backend access checks for auction listing, detail, bid history, and bidding routes.


// add one more AI interactions that meaningfully influenced the project


## Session 3: Choosing an authentication method

### Prompt

We are building a course project using Node.js, Express, and PostgreSQL and we need authentication for a REST API that will be used by a simple frontend. What authentication method would make the most sense for this type of project? We want something that is secure enough for the project but still realistic for us to implement in the time we have. Right now we need users to be able to register, log in, and then access endpoints like creating auctions and placing bids only after authentication. Would it make sense to use sessions, or should we use JWT? Also recommend how to store passwords safely in the database?

### AI Response (trimmed summary)

The AI suggested using bcrypt to hash passwords before storing them in PostgreSQL and using JWTs for login sessions and protected API routes. It described a flow where registration stores a hashed password, login verifies the password and returns a signed token, and protected routes validate the token before allowing access.

### What Your Team Did With It

- The useful part was the recommendation to use a simple JWT + bcrypt flow instead of a more complex authentication system.
- We did not treat the AI suggestion as final code. We adapted it to our own backend structure and route design.
- We verified the approach by implementing registration, login, password hashing, and token-protected routes in the API, then testing them through the frontend and local API calls.
- We also checked that the final implementation matched the actual needs of the project instead of adding unnecessary complexity.


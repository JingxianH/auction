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

## Session 2: CI/CD approach

### Prompt

We are building a web application deployed on DigitalOcean and orchestrated via Kubernetes. Currently, our cluster runs two API pods, one worker pod, a cron job, and a PostgreSQL database. We use GitHub Actions for our CI/CD pipeline by running kubectl commands to deploy application changes. However, this approach only updates the API workloads and does not manage our underlying cloud infrastructure. What are the best tools and industry-standard practices we can integrate with GitHub Actions to automatically detect and provision changes to both our Kubernetes configurations and our DigitalOcean cloud infrastructure?

### AI Response

Adopt a GitOps approach for your stack:
- Terraform: Run within GitHub Actions to automatically provision and manage your DigitalOcean infrastructure (managed PostgreSQL, Kubernetes clusters).
- Argo CD or Flux: Install within your cluster to automatically pull and synchronize Kubernetes configurations directly from your repository.

### What Your Team Did With It
- Watched couple youtube videos about these two approaches and decided to use terraform
- This is because Jingxian worked with terraform before and have experience on deploying app to AWS environment throgh terraform script
- Create a simple main.tf and use GHA to run the terraform script to achieve CI/CD

## Session 3: Secrets and Credentials 

### Prompt

We are using GitHub Actions to run Terraform scripts that deploy infrastructure changes to DigitalOcean. We know we shouldn't hardcode credentials in our Terraform files, and GitHub's secret scanning rightfully blocks commits containing sensitive data. Currently, we have our credentials defined as sensitive variables in our Terraform configuration, for example:

```
variable "spaces_access_id" {
  description = "Access key for DigitalOcean Spaces"
  type        = string
  sensitive   = true
}
```

How do we correctly pass these secrets into our Terraform execution step within the GitHub Actions workflow file without exposing them in logs

### AI Response summary

Store your credentials in GitHub Actions Secrets. In your workflow step, map these secrets to environment variables using the TF_VAR_ prefix. Terraform automatically detects these variables and binds them to your Terraform configuration. GitHub inherently masks any ${{ secrets.* }} values in the execution logs.

```
YAML
steps:
  - name: Terraform Apply
    run: terraform apply -auto-approve
    env:
      # Maps to the "spaces_access_id" variable
      TF_VAR_spaces_access_id: ${{ secrets.SPACES_ACCESS_ID }}
```

### What your team did with it

We manually set all our credentials in github variables and we took this yml template and added to our deploy.yml file for github action fetch the correct tokens. 

Example
```
   - name: Terraform Apply (Cluster + Spaces + Monitoring Alerts)
        env:
          DIGITALOCEAN_TOKEN: ${{ secrets.DIGITALOCEAN_TOKEN }}
          ENABLE_MONITOR_ALERTS: ${{ secrets.ENABLE_MONITOR_ALERTS || 'false' }}
          CREATE_BACKUP_BUCKET: ${{ secrets.CREATE_BACKUP_BUCKET || 'false' }}
          BACKUP_BUCKET_NAME: ${{ secrets.BACKUP_BUCKET_NAME }}
        run: |
          terraform apply -auto-approve -input=false \
            -var="spaces_access_id=${{ secrets.SPACES_ACCESS_ID }}" \
            -var="spaces_secret_key=${{ secrets.SPACES_SECRET_KEY }}" \
            -var="alert_email=${{ secrets.ALERT_EMAIL }}" \
            -var="enable_monitor_alerts=$ENABLE_MONITOR_ALERTS" \
            -var="create_backup_bucket=$CREATE_BACKUP_BUCKET" \
            -var="backup_bucket_name=$BACKUP_BUCKET_NAME"
```

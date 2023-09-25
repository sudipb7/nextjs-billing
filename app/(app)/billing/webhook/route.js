import prisma from "@/lib/prisma";


async function processEvent(event) {

  let processingError = ''

  const customData = event.body['meta']['custom_data'] || null

  if (!customData) {

    processingError = 'No user ID, can\'t process'

  } else {

    const obj = event.body['data']

    if ( event.eventName.startsWith('subscription_payment_') ) {
      // Save subscription invoices; obj is a "Subscription invoice"

    } else if ( event.eventName.startsWith('subscription_') ) {
      // Save subscriptions; obj is a "Subscription"

      const data = obj['attributes']

      // We assume the Plan table is up to date
      const plan = await prisma.plan.findUnique({
        where: {
          variantId: data['variant_id']
        },
      })

      if (!plan) {

        processingError = 'Plan not found in DB. Could not process webhook event.'

      } else {

        // Update the subscription

        const lemonSqueezyId = parseInt(obj['id'])

        const updateData = {
          orderId: data['order_id'],
          name: data['user_name'],
          email: data['user_email'],
          status: data['status'],
          renewsAt: data['renews_at'],
          endsAt: data['ends_at'],
          trialEndsAt: data['trial_ends_at'],
          planId: plan['id'],
          userId: customData['user_id'],
          price: event.eventName == 'subscription_created' ? plan['price'] : null
        }

        const createData = updateData
        createData.lemonSqueezyId = lemonSqueezyId
        createData.price = plan.price

        try {

          // Create/update subscription
          await prisma.subscription.upsert({
            where: {
              lemonSqueezyId: lemonSqueezyId
            },
            update: updateData,
            create: createData,
          })

        } catch (error) {
          processingError = error
          console.log(error)
        }

      }

    }

    try {

      // Mark event as processed
      await prisma.webhookEvent.update({
        where: {
          id: event.id
        },
        data: {
          processed: true,
          processingError
        }
      })
    } catch (error) {
      console.log(error)
    }


  }
}


export async function POST(request) {
  
  const crypto = require('crypto');

  const rawBody = await request.text()

  const secret    = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  const hmac      = crypto.createHmac('sha256', secret);
  const digest    = Buffer.from(hmac.update(rawBody).digest('hex'), 'utf8');
  const signature = Buffer.from(request.headers.get('X-Signature') || '', 'utf8');

  if (!crypto.timingSafeEqual(digest, signature)) {
      throw new Error('Invalid signature.');
  }

  const data = JSON.parse(rawBody)

  const event = await prisma.webhookEvent.create({
    data: {
      eventName: data['meta']['event_name'],
      body: data
    },
  })

  // Process
  processEvent(event)
  
  return new Response('Done');
}

